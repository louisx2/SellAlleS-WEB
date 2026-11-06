-- Facturación electrónica (e-CF) con MSeller: funciones de servidor, Vault y cron.
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz), secciones 7 y 10.
--
-- Lo que las Edge Functions (ecf-emitir, ecf-estado, ecf-admin) piden a la base:
--   * guardar y leer las credenciales de MSeller de cada empresa y ambiente.
--     Las claves viven en Vault; ecf_credenciales solo apunta a ellas;
--   * reservar un documento antes de enviarlo (una sola sentencia, la gana quien
--     llegue primero);
--   * llevar la cuenta de lo gastado del plan de MSeller en el mes;
--   * saber qué documentos faltan por enviar y qué e-NCF hay que consultar;
--   * el despacho: dos funciones que llaman a las Edge Functions con la service
--     role key de Vault (mismo patrón que _enviar_correo_plataforma) y dos tareas
--     de pg_cron que las corren.
--
-- Todas son solo del servidor: security definer, search_path = public, sin
-- ejecución para PUBLIC, anon ni authenticated, y con ejecución para
-- service_role. Ninguna escribe un secreto en un log ni en un mensaje de error.
-- Mientras ninguna empresa tenga `ecf_activa`, las tareas de cron no hacen nada.

-- ---------------------------------------------------------------------------
-- 1. Vault
-- ---------------------------------------------------------------------------
-- Crea el secreto o, si ya hay uno con ese nombre, le cambia el valor: guardar
-- dos veces deja un solo secreto por nombre. Devuelve su id.
create or replace function public._ecf_guardar_secreto(p_nombre text, p_valor text, p_descripcion text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_nombre;
  if v_id is null then
    return vault.create_secret(p_valor, p_nombre, p_descripcion);
  end if;
  perform vault.update_secret(v_id, p_valor, p_nombre, p_descripcion);
  return v_id;
end;
$$;

revoke execute on function public._ecf_guardar_secreto(text, text, text) from public, anon, authenticated;
grant execute on function public._ecf_guardar_secreto(text, text, text) to service_role;

-- Guarda la cuenta de MSeller de una empresa en un ambiente. Como la cuenta
-- cambió, se olvida la sesión que había: idToken, sub y refresh token (también
-- el secreto de Vault, que era de la cuenta anterior).
create or replace function public.ecf_guardar_credenciales(
  p_company uuid, p_ambiente text, p_email text, p_password text, p_api_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base    text;
  v_pass    uuid;
  v_key     uuid;
  v_refresh uuid;
begin
  if p_ambiente is null or p_ambiente not in ('TesteCF', 'CerteCF', 'eCF') then
    raise exception 'El ambiente de e-CF no es válido: %.', coalesce(p_ambiente, 'vacío');
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is null
     or coalesce(p_password, '') = '' or coalesce(p_api_key, '') = '' then
    raise exception 'Faltan el correo, la contraseña o la API key de MSeller.';
  end if;

  v_base := 'ecf/' || p_company || '/' || p_ambiente || '/';
  v_pass := public._ecf_guardar_secreto(v_base || 'password', p_password, 'e-CF MSeller: contraseña');
  v_key  := public._ecf_guardar_secreto(v_base || 'api_key', p_api_key, 'e-CF MSeller: API key');

  select refresh_token_secret_id into v_refresh
    from public.ecf_credenciales
   where company_id = p_company and ambiente = p_ambiente;

  insert into public.ecf_credenciales (company_id, ambiente, email, password_secret_id, api_key_secret_id)
  values (p_company, p_ambiente, btrim(p_email), v_pass, v_key)
  on conflict (company_id, ambiente) do update
    set email                   = excluded.email,
        password_secret_id      = excluded.password_secret_id,
        api_key_secret_id       = excluded.api_key_secret_id,
        refresh_token_secret_id = null,
        sub                     = null,
        id_token                = null,
        id_token_vence          = null,
        updated_at              = now();

  if v_refresh is not null then
    delete from vault.secrets where id = v_refresh;
  end if;
end;
$$;

revoke execute on function public.ecf_guardar_credenciales(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ecf_guardar_credenciales(uuid, text, text, text, text) to service_role;

-- Lo que la Edge Function necesita para hablar con MSeller. Es null si la
-- empresa no tiene credenciales guardadas en ese ambiente. Las claves se
-- descifran aquí y van solo al servidor.
create or replace function public.ecf_leer_credenciales(p_company uuid, p_ambiente text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'email',          c.email,
           'password',       p.decrypted_secret,
           'api_key',        k.decrypted_secret,
           'refresh_token',  r.decrypted_secret,
           'sub',            c.sub,
           'id_token',       c.id_token,
           'id_token_vence', c.id_token_vence)
    from public.ecf_credenciales c
    left join vault.decrypted_secrets p on p.id = c.password_secret_id
    left join vault.decrypted_secrets k on k.id = c.api_key_secret_id
    left join vault.decrypted_secrets r on r.id = c.refresh_token_secret_id
   where c.company_id = p_company and c.ambiente = p_ambiente;
$$;

revoke execute on function public.ecf_leer_credenciales(uuid, text) from public, anon, authenticated;
grant execute on function public.ecf_leer_credenciales(uuid, text) to service_role;

-- Guarda la sesión abierta con MSeller. El refresh token va a Vault; si llega
-- null (al renovar el idToken MSeller no manda otro) se conserva el que había,
-- y lo mismo con el sub.
create or replace function public.ecf_guardar_sesion(
  p_company uuid, p_ambiente text, p_id_token text, p_id_token_vence timestamptz,
  p_refresh_token text, p_sub text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refresh uuid;
begin
  select refresh_token_secret_id into v_refresh
    from public.ecf_credenciales
   where company_id = p_company and ambiente = p_ambiente
   for update;
  if not found then
    raise exception 'No hay credenciales de e-CF guardadas para esa empresa y ambiente.';
  end if;

  if p_refresh_token is not null then
    v_refresh := public._ecf_guardar_secreto(
      'ecf/' || p_company || '/' || p_ambiente || '/refresh_token',
      p_refresh_token, 'e-CF MSeller: refresh token');
  end if;

  update public.ecf_credenciales
     set id_token                = p_id_token,
         id_token_vence          = p_id_token_vence,
         refresh_token_secret_id = v_refresh,
         sub                     = coalesce(p_sub, sub),
         updated_at              = now()
   where company_id = p_company and ambiente = p_ambiente;
end;
$$;

revoke execute on function public.ecf_guardar_sesion(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.ecf_guardar_sesion(uuid, text, text, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reservar un documento
-- ---------------------------------------------------------------------------
-- Una sola sentencia: pasa el documento a `enviando` por dos minutos y cuenta
-- el intento. Devuelve la fila si lo reservó y nada si otro llegó primero, si
-- aún no toca (próximo intento en el futuro) o si ya no está por enviar. Un
-- `enviando` con la reserva vencida (el envío anterior murió a medias) se puede
-- reservar de nuevo.
create or replace function public.ecf_reservar_documento(p_id uuid)
returns setof public.ecf_documentos
language sql
security definer
set search_path = public
as $$
  update public.ecf_documentos
     set estado          = 'enviando',
         reservado_hasta = now() + interval '2 minutes',
         intentos        = intentos + 1,
         updated_at      = now()
   where id = p_id
     and ((estado = 'por_enviar' and proximo_intento_at <= now())
          or (estado = 'enviando' and coalesce(reservado_hasta, '-infinity') <= now()))
  returning *;
$$;

revoke execute on function public.ecf_reservar_documento(uuid) from public, anon, authenticated;
grant execute on function public.ecf_reservar_documento(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Uso del plan
-- ---------------------------------------------------------------------------
-- Suma lo gastado (llamadas a MSeller y comprobantes) en el mes en curso. El
-- periodo es el día 1 del mes en UTC, que es cuando reinicia el cupo.
create or replace function public.ecf_sumar_uso(p_company uuid, p_requests int, p_comprobantes int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ecf_uso (company_id, periodo, comprobantes, requests)
  values (p_company, date_trunc('month', now() at time zone 'utc')::date, p_comprobantes, p_requests)
  on conflict (company_id, periodo) do update
    set comprobantes = public.ecf_uso.comprobantes + excluded.comprobantes,
        requests     = public.ecf_uso.requests + excluded.requests;
$$;

revoke execute on function public.ecf_sumar_uso(uuid, int, int) from public, anon, authenticated;
grant execute on function public.ecf_sumar_uso(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Trabajo pendiente
-- ---------------------------------------------------------------------------
-- Los documentos que el cron debe mandar a ecf-emitir, de empresas con e-CF
-- activo, los más antiguos primero:
--   * `por_enviar` cuyo próximo intento ya llegó y que tienen más de un minuto
--     (el primer minuto es del punto de venta, que los manda al guardar);
--   * `enviando` con la reserva vencida.
-- Antes devuelve a la fila los `sin_cupo` que ya pueden salir: los que se
-- quedaron sin cupo en un mes anterior (el cupo reinició) o antes del último
-- cambio de ecf_config (cambió el plan). Por eso tiene efectos y es volatile.
create or replace function public.ecf_documentos_por_enviar(p_limite int default 50)
returns setof uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_mes timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  update public.ecf_documentos d
     set estado             = 'por_enviar',
         proximo_intento_at = now(),
         estado_at          = now(),
         updated_at         = now()
    from public.ecf_config c
   where c.company_id = d.company_id
     and d.estado = 'sin_cupo'
     and public.ecf_activa(d.company_id)
     and (coalesce(d.estado_at, d.created_at) < v_mes
          or coalesce(d.estado_at, d.created_at) < c.updated_at);

  return query
  select d.id
    from public.ecf_documentos d
   where public.ecf_activa(d.company_id)
     and ((d.estado = 'por_enviar'
           and d.proximo_intento_at <= now()
           and d.created_at < now() - interval '1 minute')
          or (d.estado = 'enviando'
              and coalesce(d.reservado_hasta, '-infinity') <= now()))
   order by d.created_at
   limit p_limite;
end;
$$;

revoke execute on function public.ecf_documentos_por_enviar(int) from public, anon, authenticated;
grant execute on function public.ecf_documentos_por_enviar(int) to service_role;

-- Los e-NCF que siguen en `recibido` (la DGII aún no respondió), por empresa y
-- ambiente, hasta 100 por consulta (los más antiguos). Solo si ya pasó el
-- tiempo entre consultas de su plan desde la consulta más reciente.
create or replace function public.ecf_consultas_pendientes()
returns table (company_id uuid, ambiente text, encfs text[])
language sql
security definer
set search_path = public
as $$
  select r.company_id,
         r.ambiente,
         array_agg(r.encf order by r.created_at, r.encf) filter (where r.n <= 100)
    from (
      select d.company_id, d.ambiente, d.encf, d.created_at, d.ultima_consulta_at,
             row_number() over (partition by d.company_id, d.ambiente order by d.created_at, d.encf) as n
        from public.ecf_documentos d
       where d.estado = 'recibido'
    ) r
    join public.ecf_config c on c.company_id = r.company_id
   group by r.company_id, r.ambiente, c.minutos_entre_consultas
  having coalesce(max(r.ultima_consulta_at), 'epoch'::timestamptz)
           < now() - c.minutos_entre_consultas * interval '1 minute';
$$;

revoke execute on function public.ecf_consultas_pendientes() from public, anon, authenticated;
grant execute on function public.ecf_consultas_pendientes() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Despacho a las Edge Functions
-- ---------------------------------------------------------------------------
-- Igual que _enviar_correo_plataforma: la llamada sale de la base con la
-- service role key de Vault. Si la llave no está solo avisa; el cron lo
-- intenta de nuevo al minuto siguiente.
create or replace function public.ecf_disparar_envios()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_key text;
begin
  select array_agg(x) into v_ids from public.ecf_documentos_por_enviar() x;
  if v_ids is null then
    return;
  end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning 'ecf_disparar_envios: falta service_role_key en Vault; no se envían % documento(s).', cardinality(v_ids);
    return;
  end if;
  perform net.http_post(
    url     := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/ecf-emitir',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('documentoIds', to_jsonb(v_ids))
  );
end;
$$;

revoke execute on function public.ecf_disparar_envios() from public, anon, authenticated;
grant execute on function public.ecf_disparar_envios() to service_role;

create or replace function public.ecf_disparar_consultas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if not exists (select 1 from public.ecf_consultas_pendientes()) then
    return;
  end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise warning 'ecf_disparar_consultas: falta service_role_key en Vault; no se consulta el estado.';
    return;
  end if;
  perform net.http_post(
    url     := 'https://qwpjclqinruhtxgkrxwr.supabase.co/functions/v1/ecf-estado',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.ecf_disparar_consultas() from public, anon, authenticated;
grant execute on function public.ecf_disparar_consultas() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Cron
-- ---------------------------------------------------------------------------
-- Volver a programar el mismo nombre reemplaza la tarea.
select cron.schedule('ecf-envios', '* * * * *', $cron$select public.ecf_disparar_envios()$cron$);
select cron.schedule('ecf-consultas', '*/15 * * * *', $cron$select public.ecf_disparar_consultas()$cron$);
