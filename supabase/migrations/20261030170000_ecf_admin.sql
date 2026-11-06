-- Facturación electrónica (e-CF) con MSeller: administración desde el panel de
-- SellAlleS.
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz), secciones 5 y 11.
--
-- Lo que el panel (solo el super admin de la plataforma) pide a la base, además
-- de la Edge Function `ecf-admin` que guarda las credenciales y prueba la
-- conexión:
--   * ecf_cambiar_estado: preparación, activa o suspendida. Para pasar a
--     activa exige que esté todo listo;
--   * ecf_credenciales_guardadas: qué ambientes tienen credenciales y con qué
--     correo, sin devolver nunca un secreto;
--   * ecf_resumen_plataforma: todas las empresas con e-CF, su uso del mes
--     contra su cupo, lo pendiente y lo que dio problemas.
--
-- Las tres son security definer con search_path = public y comprueban
-- is_super_admin() por dentro: las llama el navegador con la sesión del super
-- admin (authenticated), nunca anon. Ninguna devuelve ni registra un secreto.
--
-- Además, dos disparadores mantienen verdad la marca `conexion_probada_at`,
-- que es lo que deja activar la empresa: la prueba vale para las credenciales
-- y el ambiente con los que se hizo, así que cambiar el ambiente de la empresa
-- o guardar otras credenciales de ese ambiente la borra.

-- ---------------------------------------------------------------------------
-- 1. Cambiar el estado de la empresa
-- ---------------------------------------------------------------------------
-- Pasar a `activa` exige, en este orden (el primero que falte es el mensaje):
-- empresa formalizada, módulo `ecf` encendido, datos del emisor completos,
-- conexión probada, una secuencia E32 vigente (las mismas condiciones con las
-- que assign_ncf elige la secuencia) y, si el ambiente no es producción, que
-- sea la empresa demo. Volver a `preparacion` o pasar a `suspendida` no pide
-- nada. Pedir el estado que ya tiene no cambia nada.
create or replace function public.ecf_cambiar_estado(p_company uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg         public.ecf_config%rowtype;
  v_hay_config  boolean;
  v_formalizada boolean;
  v_demo        boolean;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Solo el administrador de la plataforma puede cambiar el estado de la facturación electrónica.';
  end if;
  if p_estado is null or p_estado not in ('preparacion', 'activa', 'suspendida') then
    raise exception 'El estado de e-CF no es válido: %.', coalesce(p_estado, 'vacío');
  end if;

  select is_formalized, is_demo into v_formalizada, v_demo
    from public.companies where id = p_company;
  if not found then
    raise exception 'La empresa no existe.';
  end if;

  -- La fila queda bloqueada hasta el final: nadie cambia el ambiente o la
  -- prueba de conexión entre las comprobaciones y el cambio de estado.
  select * into v_cfg from public.ecf_config where company_id = p_company for update;
  v_hay_config := found;

  if v_hay_config and v_cfg.estado = p_estado then
    return;
  end if;

  if p_estado <> 'activa' then
    if not v_hay_config then
      raise exception 'La empresa no tiene configuración de e-CF.';
    end if;
  else
    if not coalesce(v_formalizada, false) then
      raise exception 'La empresa no está formalizada.';
    end if;
    if not exists (select 1 from public.company_modules
                    where company_id = p_company and module_key = 'ecf' and enabled) then
      raise exception 'El módulo de facturación electrónica está apagado.';
    end if;
    if not v_hay_config
       or v_cfg.rnc_emisor is null
       or nullif(btrim(v_cfg.razon_social), '') is null
       or nullif(btrim(v_cfg.direccion), '') is null then
      raise exception 'Faltan datos del emisor (RNC, razón social o dirección).';
    end if;
    if v_cfg.conexion_probada_at is null then
      raise exception 'La conexión con el proveedor no se ha probado.';
    end if;
    -- Las condiciones de assign_ncf para el consumo electrónico (E32).
    if not exists (select 1 from public.ncf_sequences
                    where company_id = p_company
                      and tipo = 'consumer'
                      and prefix = 'E32'
                      and electronica
                      and active
                      and current_val <= range_to
                      and (expires_at is null or expires_at >= public.company_today(p_company))) then
      raise exception 'No hay una secuencia E32 vigente.';
    end if;
    if v_cfg.ambiente <> 'eCF' and not coalesce(v_demo, false) then
      raise exception 'Solo la empresa demo puede activarse en un ambiente de pruebas.';
    end if;
  end if;

  update public.ecf_config
     set estado      = p_estado,
         activada_at = case when p_estado = 'activa' then now() else activada_at end
   where company_id = p_company;
end;
$$;

comment on function public.ecf_cambiar_estado(uuid, text) is
  'Super admin: cambia el estado de e-CF de la empresa. Para pasar a activa exige formalizada, módulo encendido, datos del emisor, conexión probada, secuencia E32 vigente y ambiente eCF (o empresa demo).';

revoke all on function public.ecf_cambiar_estado(uuid, text) from public;
revoke execute on function public.ecf_cambiar_estado(uuid, text) from anon;
grant execute on function public.ecf_cambiar_estado(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Qué credenciales hay guardadas
-- ---------------------------------------------------------------------------
-- Solo el ambiente, el correo de la cuenta y cuándo se guardó. La contraseña,
-- la API key y los tokens nunca salen de la base hacia el navegador.
create or replace function public.ecf_credenciales_guardadas(p_company uuid)
returns table (ambiente text, email text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Solo el administrador de la plataforma puede ver las credenciales de e-CF guardadas.';
  end if;

  return query
  select c.ambiente, c.email, c.updated_at
    from public.ecf_credenciales c
   where c.company_id = p_company
   order by c.ambiente;
end;
$$;

comment on function public.ecf_credenciales_guardadas(uuid) is
  'Super admin: en qué ambientes tiene credenciales de MSeller la empresa, con el correo y la fecha. Nunca devuelve secretos.';

revoke all on function public.ecf_credenciales_guardadas(uuid) from public;
revoke execute on function public.ecf_credenciales_guardadas(uuid) from anon;
grant execute on function public.ecf_credenciales_guardadas(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Resumen de la plataforma
-- ---------------------------------------------------------------------------
-- Una fila por empresa con configuración de e-CF. El uso es el del mes en
-- curso en UTC (así reinicia el cupo de MSeller). `pendientes`: documentos que
-- aún no llegaron a la DGII (por enviar, enviando o recibidos). `problemas`:
-- los vigentes que quedaron rechazados, con error de datos o sin cupo (un
-- rechazado ya reemitido no cuenta: lo sustituye otro).
create or replace function public.ecf_resumen_plataforma()
returns table (
  company_id        uuid,
  empresa           text,
  estado            text,
  ambiente          text,
  plan              text,
  cupo_comprobantes int,
  cupo_requests     int,
  comprobantes      int,
  requests          int,
  pendientes        int,
  problemas         int,
  certificado_vence date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Solo el administrador de la plataforma puede ver el resumen de e-CF.';
  end if;

  return query
  select c.company_id,
         e.name,
         c.estado,
         c.ambiente,
         c.plan,
         c.cupo_comprobantes,
         c.cupo_requests,
         coalesce(u.comprobantes, 0),
         coalesce(u.requests, 0),
         coalesce(d.pendientes, 0)::int,
         coalesce(d.problemas, 0)::int,
         c.certificado_vence
    from public.ecf_config c
    join public.companies e on e.id = c.company_id
    left join public.ecf_uso u
           on u.company_id = c.company_id
          and u.periodo = date_trunc('month', now() at time zone 'utc')::date
    left join lateral (
      select count(*) filter (where x.estado in ('por_enviar', 'enviando', 'recibido')) as pendientes,
             count(*) filter (where x.estado in ('rechazado', 'error_datos', 'sin_cupo')
                                and x.reemplazado_por is null) as problemas
        from public.ecf_documentos x
       where x.company_id = c.company_id
    ) d on true
   order by e.name, c.company_id;
end;
$$;

comment on function public.ecf_resumen_plataforma() is
  'Super admin: cada empresa con e-CF, su estado, uso del mes (UTC) contra su cupo, documentos pendientes y con problemas, y vencimiento del certificado.';

revoke all on function public.ecf_resumen_plataforma() from public;
revoke execute on function public.ecf_resumen_plataforma() from anon;
grant execute on function public.ecf_resumen_plataforma() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La prueba de conexión vale para lo que se probó
-- ---------------------------------------------------------------------------
-- Cambiar el ambiente de la empresa (p. ej. de CerteCF a eCF para activar):
-- la conexión del ambiente nuevo no se ha probado.
create or replace function public.ecf_config_ambiente_cambia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ambiente is distinct from old.ambiente then
    new.conexion_probada_at := null;
  end if;
  return new;
end $$;

revoke all on function public.ecf_config_ambiente_cambia() from public, anon, authenticated;

drop trigger if exists ecf_config_ambiente_cambia on public.ecf_config;
create trigger ecf_config_ambiente_cambia
  before update of ambiente on public.ecf_config
  for each row execute function public.ecf_config_ambiente_cambia();

-- Guardar otro correo, contraseña o API key del ambiente en uso: lo probado
-- eran las credenciales anteriores. Guardar la sesión (ecf_guardar_sesion) no
-- toca estas columnas y no borra la marca. Solo escribe en ecf_config si había
-- una marca que borrar, para no mover su updated_at (la tarea 4 lo usa para
-- saber si cambió el plan).
create or replace function public.ecf_credenciales_cambian()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ecf_config
     set conexion_probada_at = null
   where company_id = new.company_id
     and ambiente = new.ambiente
     and conexion_probada_at is not null;
  return null;
end $$;

revoke all on function public.ecf_credenciales_cambian() from public, anon, authenticated;

drop trigger if exists ecf_credenciales_cambian on public.ecf_credenciales;
create trigger ecf_credenciales_cambian
  after insert or update of email, password_secret_id, api_key_secret_id on public.ecf_credenciales
  for each row execute function public.ecf_credenciales_cambian();
