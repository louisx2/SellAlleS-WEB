-- Facturación electrónica (e-CF) con MSeller: ajustes de la revisión final de
-- la rama. Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz).
--
-- Las migraciones 20261030120000 … 20261030170000 todavía no se han aplicado en
-- ninguna parte: este archivo trae solo lo que cambió después de revisarlas
-- juntas, para aplicarlo séptimo, después de ellas. Cada función que se
-- redefine parte de su definición en esas migraciones (no de copias viejas del
-- repo) y conserva security definer, search_path = public y sus permisos.
--
--   1. ecf_config: con la empresa activa no se cambia el ambiente, y desde la
--      API (authenticated) solo se escriben las columnas de datos; el estado y
--      las marcas de conexión y activación solo las cambian las funciones.
--   2. El e-NCF de una venta solo lo asigna el sistema: la venta que llega con
--      uno escrito se rechaza, y cambiarlo después solo lo puede reemitir_ecf.
--   3. Secuencias E: las que no son E32 ni E34 llevan vencimiento; el rango cabe
--      en los 10 dígitos del e-NCF.
--   4. Solo se reserva (y se envía) el documento de una empresa con e-CF activo.
--   5. Fallos persistentes de MSeller: la consulta de estados deja de pedir lo
--      que lleva más de 72 horas sin respuesta y mide el intervalo por empresa;
--      el lote pospone 30 minutos lo de una empresa cuyas credenciales MSeller
--      rechazó, y guardar credenciales nuevas lo devuelve a la fila.
--   6. El resumen diario avisa de lo que se quedó atascado.
--   7. Índices, annul_sale lee el documento vigente con `for share` y permisos
--      explícitos de service_role.
--
-- Mientras ninguna empresa tenga `ecf_activa`, nada de esto cambia el
-- comportamiento de hoy: lo único que alcanza a todas es que una venta no puede
-- traer ni recibir a mano un NCF que empiece por E.

-- ---------------------------------------------------------------------------
-- 1. ecf_config: ambiente y columnas que se escriben desde la API
-- ---------------------------------------------------------------------------
-- Con la empresa activa, cambiar el ambiente mandaría los comprobantes
-- siguientes a otro ambiente de MSeller sin pasar por las comprobaciones de
-- ecf_cambiar_estado. Primero se pasa a preparación. Fuera de `activa`, cambiar
-- el ambiente sigue borrando la prueba de conexión.
create or replace function public.ecf_config_ambiente_cambia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ambiente is distinct from old.ambiente then
    if old.estado = 'activa' then
      raise exception 'Pasa la empresa a preparación antes de cambiar el ambiente.';
    end if;
    new.conexion_probada_at := null;
  end if;
  return new;
end $$;

revoke all on function public.ecf_config_ambiente_cambia() from public, anon, authenticated;

-- El panel (el super admin, como authenticated) escribe solo los datos del
-- emisor, el ambiente, el plan y el certificado. estado, conexion_probada_at y
-- activada_at quedan fuera: los cambian ecf_cambiar_estado, ecf-admin (service
-- role) y los disparadores. updated_at lo pone el disparador. company_id solo
-- al crear la fila: cambiarlo movería una configuración activa a otra empresa.
revoke insert, update on public.ecf_config from authenticated;
grant insert (company_id, rnc_emisor, razon_social, nombre_comercial, direccion, ambiente, plan,
              cupo_comprobantes, cupo_requests, minutos_entre_consultas, certificado_vence)
  on public.ecf_config to authenticated;
grant update (rnc_emisor, razon_social, nombre_comercial, direccion, ambiente, plan,
              cupo_comprobantes, cupo_requests, minutos_entre_consultas, certificado_vence)
  on public.ecf_config to authenticated;

-- ---------------------------------------------------------------------------
-- 2. El e-NCF de una venta lo asigna el sistema
-- ---------------------------------------------------------------------------
-- set_sale_ncf parte de su versión de 20261030130000_ecf_asignacion.sql. Lo
-- único nuevo es el rechazo del principio: un e-NCF que llegue escrito en la
-- venta (por la API, o por create_sale_with_items, que copia p_sale->>'ncf') no
-- sale de ninguna secuencia y la bandeja lo mandaría a la DGII. Es el último
-- BEFORE INSERT de sales (por nombre), así que ve el NCF tal como llegó.
create or replace function public.set_sale_ncf()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ecf          boolean;
  v_rnc_sucursal text;
  v_rnc_emisor   text;
begin
  if new.ncf ~ '^E' then
    raise exception 'El número de comprobante electrónico lo asigna el sistema.';
  end if;

  v_ecf := public.ecf_activa(new.company_id);

  -- Con e-CF activo no hay venta sin comprobante: se pide aunque el cajero no
  -- lo haya pedido, con consumidor final (E32) si no viene otro tipo. Las
  -- ventas de días anteriores (cargadas después) quedan como llegan.
  if v_ecf and new.ncf is null
     and public.sale_local_date(new.company_id, new.created_at) = public.company_today(new.company_id) then
    new.ncf_requested := true;
    new.ncf_type := coalesce(new.ncf_type, 'consumer');
  end if;

  if new.ncf is null and coalesce(new.ncf_requested, false) then
    -- Las sucursales emiten con el RNC de la empresa: una con otro RNC es otro
    -- contribuyente. Se rechaza antes de gastar un número. Se comparan solo los
    -- dígitos (el RNC de la sucursal es texto libre: con guiones o espacios).
    if v_ecf and new.branch_id is not null then
      select regexp_replace(coalesce(b.rnc, ''), '\D', '', 'g') into v_rnc_sucursal
        from public.branches b where b.id = new.branch_id;
      select c.rnc_emisor into v_rnc_emisor
        from public.ecf_config c where c.company_id = new.company_id;
      if v_rnc_sucursal <> '' and v_rnc_sucursal is distinct from v_rnc_emisor then
        raise exception 'Esta sucursal tiene un RNC distinto al de la empresa; no puede emitir e-CF con el de la empresa.';
      end if;
    end if;

    new.ncf := public.assign_ncf(new.company_id, new.ncf_type::text);
  end if;
  return new;
end;
$function$;

revoke all on function public.set_sale_ncf() from public, anon, authenticated;

-- Una venta guardada no cambia de e-NCF ni pasa a tener uno escrito a mano. La
-- única excepción es reemitir_ecf, que enciende la marca de transacción
-- `sellalles.reemitiendo_ecf` justo antes de su UPDATE (desde la API no se
-- puede: set_config no está expuesto).
create or replace function public.ecf_proteger_ncf_venta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ncf is distinct from old.ncf
     and (coalesce(old.ncf ~ '^E', false) or coalesce(new.ncf ~ '^E', false))
     and coalesce(current_setting('sellalles.reemitiendo_ecf', true), '') <> 'on' then
    raise exception 'El número de comprobante electrónico lo asigna el sistema.';
  end if;
  return new;
end $$;

comment on function public.ecf_proteger_ncf_venta() is
  'Trigger BEFORE UPDATE OF ncf de sales: no deja cambiar un e-NCF ni poner uno a mano; solo reemitir_ecf (con la marca sellalles.reemitiendo_ecf de la transacción).';

revoke all on function public.ecf_proteger_ncf_venta() from public, anon, authenticated;

drop trigger if exists trg_ecf_proteger_ncf on public.sales;
create trigger trg_ecf_proteger_ncf
  before update of ncf on public.sales
  for each row execute function public.ecf_proteger_ncf_venta();

-- reemitir_ecf parte de su versión de 20261030140000_ecf_anulacion_reemision.sql.
-- Lo único nuevo es la marca alrededor del UPDATE de sales.ncf: se enciende
-- justo antes y se apaga justo después, para que nada más en la transacción la
-- aproveche.
create or replace function public.reemitir_ecf(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale  sales%rowtype;
  v_doc   ecf_documentos%rowtype;
  v_encf  text;
  v_nuevo uuid;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;

  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede reemitir comprobantes.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;

  select * into v_doc
    from ecf_documentos
   where sale_id = v_sale.id and reemplazado_por is null
   order by created_at desc
   limit 1
   for update;
  if not found or v_doc.estado <> 'rechazado' then
    raise exception 'Solo se puede reemitir un comprobante rechazado por la DGII.';
  end if;

  -- Sin e-CF activo assign_ncf devolvería una B: no es lo que se reemite.
  if not ecf_activa(v_sale.company_id) then
    raise exception 'La facturación electrónica no está activa para esta empresa.';
  end if;

  v_encf := assign_ncf(v_sale.company_id, v_sale.ncf_type::text);

  insert into ecf_documentos (company_id, branch_id, sale_id, tipo_ecf, encf, ambiente, estado)
  select v_sale.company_id, v_sale.branch_id, v_sale.id, substr(v_encf, 2, 2)::smallint, v_encf, c.ambiente, 'por_enviar'
    from ecf_config c
   where c.company_id = v_sale.company_id
  returning id into v_nuevo;

  update ecf_documentos set reemplazado_por = v_nuevo, updated_at = now() where id = v_doc.id;

  perform set_config('sellalles.reemitiendo_ecf', 'on', true);
  update sales set ncf = v_encf where id = v_sale.id;
  perform set_config('sellalles.reemitiendo_ecf', 'off', true);

  return jsonb_build_object('documento_id', v_nuevo, 'encf', v_encf);
end;
$$;

comment on function public.reemitir_ecf(uuid) is
  'Reemite con un e-NCF nuevo el comprobante rechazado por la DGII de una venta: actualiza sales.ncf, crea el documento nuevo (por_enviar) y marca el viejo como reemplazado. Solo administradores de la empresa.';

revoke all on function public.reemitir_ecf(uuid) from public;
revoke execute on function public.reemitir_ecf(uuid) from anon;
grant execute on function public.reemitir_ecf(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Secuencias E
-- ---------------------------------------------------------------------------
-- El E31, E33, E44 y E45 llevan en el comprobante la fecha de vencimiento de su
-- secuencia (sin ella el documento se arma con error de datos después de gastar
-- el número). Hoy no hay ninguna secuencia electrónica guardada.
alter table public.ncf_sequences drop constraint if exists ncf_sequences_vencimiento_e_check;
alter table public.ncf_sequences add constraint ncf_sequences_vencimiento_e_check
  check (not electronica or prefix in ('E32', 'E34') or expires_at is not null);

-- El e-NCF tiene 10 dígitos de secuencia: un número mayor no cabe.
alter table public.ncf_sequences drop constraint if exists ncf_sequences_rango_e_check;
alter table public.ncf_sequences add constraint ncf_sequences_rango_e_check
  check (not electronica or range_to <= 9999999999);

-- ---------------------------------------------------------------------------
-- 4. Reservar: solo con e-CF activo
-- ---------------------------------------------------------------------------
-- Parte de su versión de 20261030150000_ecf_servidor.sql. Una empresa
-- suspendida o en preparación no manda nada a MSeller, tampoco desde el punto de
-- venta: el documento se queda donde está hasta que se reactive.
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
     and public.ecf_activa(company_id)
     and ((estado = 'por_enviar' and proximo_intento_at <= now())
          or (estado = 'enviando' and coalesce(reservado_hasta, '-infinity') <= now()))
  returning *;
$$;

revoke execute on function public.ecf_reservar_documento(uuid) from public, anon, authenticated;
grant execute on function public.ecf_reservar_documento(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Fallos persistentes de MSeller
-- ---------------------------------------------------------------------------
-- Consultas pendientes (parte de su versión de 20261030150000_ecf_servidor.sql):
--   * un `recibido` que lleva más de 72 horas desde el envío (o desde que se
--     creó, si no tiene fecha de envío) ya no se pide: el resumen diario lo
--     avisa a las 48 y lo resuelve una persona;
--   * el tiempo entre consultas se mide desde el último lote de la empresa: la
--     consulta más reciente de cualquiera de sus documentos, no solo de los que
--     siguen recibidos (si no, uno que acaba de cambiar de estado no contaría);
--   * cada lote, hasta 100, empieza por lo que nunca se consultó y luego por lo
--     consultado hace más tiempo.
create or replace function public.ecf_consultas_pendientes()
returns table (company_id uuid, ambiente text, encfs text[])
language sql
security definer
set search_path = public
as $$
  with pendientes as (
    select d.company_id, d.ambiente, d.encf,
           row_number() over (partition by d.company_id, d.ambiente
                              order by d.ultima_consulta_at nulls first, d.created_at, d.encf) as n
      from public.ecf_documentos d
     where d.estado = 'recibido'
       and coalesce(d.enviado_at, d.created_at) >= now() - interval '72 hours'
  ),
  empresas as (
    select e.company_id
      from (select distinct p.company_id from pendientes p) e
      join public.ecf_config c on c.company_id = e.company_id
     cross join lateral (
       select max(x.ultima_consulta_at) as ultima
         from public.ecf_documentos x
        where x.company_id = e.company_id
     ) u
     where coalesce(u.ultima, '-infinity'::timestamptz)
           < now() - c.minutos_entre_consultas * interval '1 minute'
  )
  select p.company_id, p.ambiente, array_agg(p.encf order by p.n)
    from pendientes p
    join empresas e on e.company_id = p.company_id
   where p.n <= 100
   group by p.company_id, p.ambiente;
$$;

revoke execute on function public.ecf_consultas_pendientes() from public, anon, authenticated;
grant execute on function public.ecf_consultas_pendientes() to service_role;

-- MSeller rechazó el inicio de sesión de la empresa en ese ambiente: el lote de
-- ecf-emitir deja de mandar lo suyo y lo que espera se pospone 30 minutos, para
-- no insistir con una contraseña mala (la cuenta se podría bloquear). El
-- mensaje no lleva nada de la cuenta.
create or replace function public.ecf_posponer_por_credenciales(p_company uuid, p_ambiente text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ecf_documentos
     set proximo_intento_at = now() + interval '30 minutes',
         ultimo_error       = 'MSeller rechazó las credenciales de la empresa.',
         updated_at         = now()
   where company_id = p_company
     and ambiente = p_ambiente
     and estado = 'por_enviar';
$$;

comment on function public.ecf_posponer_por_credenciales(uuid, text) is
  'Servidor: pospone 30 minutos los documentos por enviar de la empresa en ese ambiente porque MSeller rechazó sus credenciales.';

revoke execute on function public.ecf_posponer_por_credenciales(uuid, text) from public, anon, authenticated;
grant execute on function public.ecf_posponer_por_credenciales(uuid, text) to service_role;

-- ecf_guardar_credenciales parte de su versión de 20261030150000_ecf_servidor.sql.
-- Lo nuevo es el final: con credenciales nuevas, lo que esperaba por las
-- anteriores sale en la próxima vuelta del cron, sin esperar los 30 minutos.
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

  update public.ecf_documentos
     set proximo_intento_at = now(),
         updated_at         = now()
   where company_id = p_company
     and ambiente = p_ambiente
     and estado = 'por_enviar'
     and proximo_intento_at > now();
end;
$$;

revoke execute on function public.ecf_guardar_credenciales(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ecf_guardar_credenciales(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. El resumen diario avisa de lo atascado
-- ---------------------------------------------------------------------------
-- Parte de su versión de 20261030160000_ecf_avisos.sql. Lo nuevo es `atascados`:
-- por empresa, lo que lleva más de 6 horas sin enviarse (por enviar o
-- enviando) y lo que lleva más de 48 horas en la DGII sin respuesta. Se avisa
-- cada día mientras siga así y, a diferencia de `docs`, también cuando es un
-- reemplazo (reemplazado_por no importa aquí: un reemplazo atascado es el que
-- tiene que salir). Orden: cupo, documentos, atascados y certificados.
create or replace function public._ecf_avisos_lineas()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  mes as (
    -- El cupo de MSeller reinicia el día 1 del mes en UTC, igual que ecf_uso.
    select date_trunc('month', now() at time zone 'utc')::date as periodo
  ),
  cupo as (
    -- 80% o más de cualquiera de los dos cupos. Un cupo en cero no se puede medir.
    select 1 as orden, e.name as empresa,
           'Cupo: ' || e.name || ' lleva ' || u.comprobantes || ' de ' || c.cupo_comprobantes
             || ' comprobantes (' || coalesce(floor(u.comprobantes * 100.0 / nullif(c.cupo_comprobantes, 0)), 0)::int
             || '%) y ' || u.requests || ' de ' || c.cupo_requests
             || ' requests (' || coalesce(floor(u.requests * 100.0 / nullif(c.cupo_requests, 0)), 0)::int
             || '%) este mes.' as linea
      from public.ecf_config c
      join public.ecf_uso u on u.company_id = c.company_id and u.periodo = (select periodo from mes)
      join public.companies e on e.id = c.company_id
     where (c.cupo_comprobantes > 0 and u.comprobantes * 100 >= c.cupo_comprobantes * 80)
        or (c.cupo_requests > 0 and u.requests * 100 >= c.cupo_requests * 80)
  ),
  docs as (
    -- Creados o cambiados de estado en las últimas 24 horas. Los que ya se
    -- reemitieron (reemplazado_por) no cuentan: ya tienen quien los sustituya.
    select 2 as orden, e.name as empresa,
           'Documentos: ' || e.name || ': '
             || concat_ws(', ',
                  case when x.rechazados > 0
                       then x.rechazados || case when x.rechazados = 1 then ' rechazado' else ' rechazados' end end,
                  case when x.errores > 0 then x.errores || ' con error de datos' end,
                  case when x.sin_cupo > 0 then x.sin_cupo || ' sin cupo' end)
             || ' (' || array_to_string(x.encfs[1:5], ', ')
             || case when x.total > 5 then ' y otros' else '' end || ').' as linea
      from (
        select d.company_id,
               count(*) as total,
               count(*) filter (where d.estado = 'rechazado') as rechazados,
               count(*) filter (where d.estado = 'error_datos') as errores,
               count(*) filter (where d.estado = 'sin_cupo') as sin_cupo,
               array_agg(d.encf order by d.created_at, d.encf) as encfs
          from public.ecf_documentos d
         where d.estado in ('rechazado', 'error_datos', 'sin_cupo')
           and d.reemplazado_por is null
           and greatest(d.created_at, d.estado_at) >= now() - interval '24 hours'
         group by d.company_id
      ) x
      join public.companies e on e.id = x.company_id
  ),
  atascados as (
    select 3 as orden, e.name as empresa,
           'Documentos: ' || e.name || ': ' || x.n
             || case when x.n = 1 then ' comprobante' else ' comprobantes' end
             || x.que as linea
      from (
        select d.company_id, count(*) as n, ' sin enviar desde hace más de 6 horas.' as que
          from public.ecf_documentos d
         where d.estado in ('por_enviar', 'enviando')
           and d.created_at < now() - interval '6 hours'
         group by d.company_id
        union all
        select d.company_id, count(*), ' sin respuesta de la DGII desde hace más de 48 horas.'
          from public.ecf_documentos d
         where d.estado = 'recibido'
           and coalesce(d.enviado_at, d.created_at) < now() - interval '48 hours'
         group by d.company_id
      ) x
      join public.companies e on e.id = x.company_id
  ),
  cert as (
    -- Vence en 30 días o menos; uno ya vencido se sigue avisando cada día.
    select 4 as orden, e.name as empresa,
           'Certificado: el de ' || e.name
             || case
                  when c.certificado_vence < current_date
                    then ' venció el ' || to_char(c.certificado_vence, 'DD/MM/YYYY') || '.'
                  when c.certificado_vence = current_date
                    then ' vence hoy.'
                  else ' vence el ' || to_char(c.certificado_vence, 'DD/MM/YYYY')
                       || ' (en ' || (c.certificado_vence - current_date)
                       || case when c.certificado_vence - current_date = 1 then ' día).' else ' días).' end
                end as linea
      from public.ecf_config c
      join public.companies e on e.id = c.company_id
     where c.certificado_vence is not null
       and c.certificado_vence <= current_date + 30
  )
  select coalesce(jsonb_agg(to_jsonb(t.linea) order by t.orden, t.empresa, t.linea), '[]'::jsonb)
    from (select * from cupo
          union all select * from docs
          union all select * from atascados
          union all select * from cert) t;
$$;

revoke execute on function public._ecf_avisos_lineas() from public, anon, authenticated;
grant execute on function public._ecf_avisos_lineas() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Índices, annul_sale y permisos de service_role
-- ---------------------------------------------------------------------------
-- Lo que el worker revisa: también los sin cupo, que ecf_documentos_por_enviar
-- busca en cada vuelta para devolverlos a la fila.
drop index if exists public.ecf_documentos_pendientes_idx;
create index ecf_documentos_pendientes_idx on public.ecf_documentos (estado)
  where estado in ('por_enviar', 'enviando', 'recibido', 'sin_cupo');

-- Las dos claves foráneas que no tenían índice.
create index if not exists ecf_documentos_branch_id_idx on public.ecf_documentos (branch_id);
create index if not exists ecf_documentos_reemplazado_por_idx on public.ecf_documentos (reemplazado_por);

-- annul_sale parte de su versión de 20261030140000_ecf_anulacion_reemision.sql.
-- Lo único nuevo es `for share` al leer el documento vigente de la venta: el
-- estado con que se decide (E34, sin nota o rechazo) no puede cambiar hasta que
-- la anulación termine.
create or replace function public.annul_sale(p_sale_id uuid, p_reason text default null::text, p_refund_method text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale          sales%rowtype;
  v_seq           ncf_sequences%rowtype;
  v_session       caja_sessions%rowtype;
  v_item          record;
  v_pay           credit_payments%rowtype;
  v_ncf           text := null;
  v_user_name     text;
  v_note_id       uuid;
  v_refund_method text;
  v_is_credit     boolean;
  v_down_paid     numeric := 0;
  v_down_method   text;
  v_voided        numeric := 0;
  v_cash_out      numeric := 0;
  v_void_reason   text;
  v_doc_estado    text;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;

  -- La función es SECURITY DEFINER (salta RLS para tomar la secuencia B04 y
  -- escribir credit_notes), así que el permiso se valida aquí. V1: solo
  -- administradores de la empresa; los roles personalizados con sales:delete
  -- ven el botón pero la base los rechaza (pendiente de unificar).
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular ventas.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;

  v_is_credit := v_sale.payment_status in ('credit', 'in_financing');

  if v_is_credit then
    select coalesce(sum(amount), 0), min(method::text)
      into v_down_paid, v_down_method
      from credit_payments
     where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null;

    -- Abonos posteriores todavía vigentes: los que nombran la venta, los
    -- generales cuyo reparto la tocó y, para los viejos sin reparto
    -- registrado, lo que `amount_paid` tenga por encima del abono inicial.
    if exists (
         select 1 from credit_payments cp
          where cp.voided_at is null
            and cp.kind <> 'down_payment'
            and (cp.sale_id = v_sale.id
                 or exists (select 1
                              from jsonb_array_elements(coalesce(cp.allocation->'sales', '[]'::jsonb)) e
                             where e->>'sale_id' = v_sale.id::text))
       )
       or v_sale.amount_paid > v_down_paid + 0.01 then
      raise exception 'Esta venta tiene abonos posteriores al abono inicial. Anúlalos primero desde el detalle de la venta (o el estado de cuenta del cliente) y luego anula la venta.';
    end if;

    -- Sin abono inicial no hay nada que devolver.
    v_refund_method := case
      when p_refund_method = 'none' or v_down_paid <= 0 then 'none'
      else v_down_method
    end;
    if p_refund_method is not null and p_refund_method not in ('none', v_refund_method) then
      raise exception 'El abono inicial entró por %: la devolución sale por esa misma vía, o elige "Sin devolución".',
        case v_down_method when 'cash' then 'efectivo' when 'card' then 'tarjeta' else 'transferencia' end;
    end if;
  else
    -- payment_method es un enum en la base: se compara/almacena como texto aquí.
    -- Sin método explícito se asume que el dinero vuelve por donde entró; 'none'
    -- hay que pedirlo a propósito, para que no se anule sin devolver por descuido.
    v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
  end if;

  if v_refund_method not in ('cash', 'card', 'transfer', 'none') then
    raise exception 'Método de devolución no válido.';
  end if;

  -- NCF de la nota de crédito: solo si la venta original llevó comprobante.
  -- Una venta facturada por error igual consumió su NCF, así que la nota de
  -- crédito se emite aunque no haya devolución: es lo que la deja anulada ante
  -- la DGII.
  if v_sale.ncf is not null then
    if v_sale.ncf ~ '^E\d{12}$' then
      -- Una venta con e-NCF solo se anula con una E34, y la E34 solo se emite
      -- con el e-CF activo: suspendido (o apagado) no se anula ni con una B04.
      if not ecf_activa(v_sale.company_id) then
        raise exception 'La facturación electrónica de esta empresa no está activa; no se puede anular una venta con comprobante electrónico hasta reactivarla.';
      end if;

      -- e-CF: lo que se puede hacer depende de en qué quedó el comprobante
      -- original (el vigente: el que no ha sido reemplazado por otro). Se lee
      -- bloqueado para que su estado no cambie mientras se decide.
      select d.estado into v_doc_estado
        from ecf_documentos d
       where d.sale_id = v_sale.id and d.reemplazado_por is null
       order by d.created_at desc
       limit 1
       for share;

      -- Sin enviar a la DGII no hay nada contra qué emitir la nota de crédito.
      if v_doc_estado in ('por_enviar', 'enviando', 'error_datos', 'sin_cupo') then
        raise exception 'Esta venta tiene su e-CF todavía sin enviar a la DGII. Espera a que salga o reintenta el envío antes de anularla.';
      end if;

      -- Rechazado: la DGII nunca lo aceptó, así que se anula sin nota de
      -- crédito (credit_notes.ncf queda null). En cualquier otro estado, aun
      -- recibido y sin respuesta, la E34 sale de la secuencia electrónica.
      if v_doc_estado is distinct from 'rechazado' then
        v_ncf := assign_ncf(v_sale.company_id, 'nota_credito');
      end if;
    else
      select * into v_seq from ncf_sequences
       where company_id = v_sale.company_id
         and tipo = 'nota_credito'
         and not electronica
         and active
         and (expires_at is null or expires_at >= company_today(v_sale.company_id))
         and current_val <= range_to
       order by created_at
       limit 1
       for update;
      if not found then
        raise exception 'No hay una secuencia de Notas de Crédito (B04) activa con números disponibles. Agrégala en Perfil de Sucursal → Facturación Fiscal.';
      end if;
      v_ncf := v_seq.prefix || lpad(v_seq.current_val::text, 8, '0');
      update ncf_sequences set current_val = current_val + 1 where id = v_seq.id;
    end if;
  end if;

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash' and caja_blocks_cash(v_sale.company_id, v_sale.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los productos que no
  -- manejan existencias quedan fuera: nunca se les descontó nada al vender.
  -- Se repone en unidad base (quantity × units_per, los de la línea: la
  -- presentación pudo haberse editado o borrado después de vender).
  for v_item in
    select si.product_id, si.quantity * si.units_per as base_qty
      from sale_items si
      join products p on p.id = si.product_id and p.company_id = v_sale.company_id
     where si.sale_id = v_sale.id
       and si.product_id is not null
       and p.tracks_stock
  loop
    update products set stock = stock + v_item.base_qty
     where id = v_item.product_id and company_id = v_sale.company_id;
  end loop;

  select name into v_user_name from profiles where id = auth.uid();

  if v_is_credit then
    v_void_reason := 'Venta anulada' || coalesce(': ' || nullif(btrim(p_reason), ''), '');

    if v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
      select * into v_session from caja_sessions
       where branch_id = v_sale.branch_id and status = 'open' for update;
    end if;

    for v_pay in
      select * from credit_payments
       where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null
       for update
    loop
      update credit_payments
         set voided_at = now(), voided_by = auth.uid(),
             voided_by_name = v_user_name, void_reason = v_void_reason
       where id = v_pay.id;
      v_voided := v_voided + v_pay.amount;

      -- Cobrado en la sesión que sigue abierta: basta con anularlo, el cierre
      -- ya no lo cuenta. Cobrado en una sesión que ya cerró con ese dinero
      -- contado: hay que sacarlo de la caja abierta ahora.
      if v_refund_method = 'cash' and v_pay.method = 'cash'
         and v_session.id is not null and v_session.opened_at > v_pay.date then
        v_cash_out := v_cash_out + v_pay.amount;
      end if;
    end loop;

    update sales set amount_paid = greatest(round(amount_paid - v_voided, 2), 0)
     where id = v_sale.id;
  end if;

  insert into credit_notes
    (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
     subtotal, itbis_amount, total, refund_method, reason, user_id, user_name)
  values
    (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id,
     v_ncf, v_sale.ncf, v_sale.subtotal, v_sale.itbis_amount, v_sale.total,
     v_refund_method, nullif(p_reason, ''), auth.uid(), v_user_name)
  returning id into v_note_id;

  update sales set cancelled_at = now() where id = v_sale.id;

  if v_is_credit then
    if v_cash_out > 0 then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_cash_out,
         'Devolución del abono inicial por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
    perform recompute_customer_balance(v_sale.customer_id);
  elsif v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
    select * into v_session from caja_sessions
     where branch_id = v_sale.branch_id and status = 'open' for update;
    if found then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_sale.total,
         'Devolución por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
  end if;

  return jsonb_build_object(
    'credit_note_id', v_note_id,
    'ncf',            v_ncf,
    'ncf_modified',   v_sale.ncf,
    'total',          v_sale.total,
    'refund_method',  v_refund_method,
    'payments_voided', v_voided
  );
end;
$function$;

-- Las cuatro tablas del e-CF las usan las Edge Functions con la service role:
-- explícito, sin depender de los privilegios por omisión del proyecto.
grant select, insert, update, delete
  on public.ecf_config, public.ecf_credenciales, public.ecf_documentos, public.ecf_uso
  to service_role;
