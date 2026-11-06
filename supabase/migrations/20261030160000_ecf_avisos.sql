-- Facturación electrónica (e-CF) con MSeller: avisos a SellAlleS.
-- Diseño: docs/2026-10-28-ecf-mseller-diseno.md (repo raíz), sección 10.
--
-- Dos correos al equipo de la plataforma (a platform_settings.support_email),
-- por el mismo canal de los demás avisos de plataforma: _enviar_correo_plataforma
-- llama a send-lifecycle-email con la plantilla `ecf-avisos`, cuyo asunto es
-- vars.titulo y cuyo cuerpo es la lista vars.lineas. Ningún correo lleva
-- secretos: solo nombres de empresa, cifras de uso, e-NCF y fechas.
--   * ecf_avisar_sin_cupo: urgente, cuando MSeller responde 429 (las llama
--     ecf-emitir y ecf-estado). Un correo por empresa y mes.
--   * ecf_avisos_diarios: un solo correo al día (cron a las 12:00 UTC) con lo
--     que merece atención: empresas al 80% o más de cualquiera de sus dos
--     cupos, documentos rechazados, con error de datos o sin cupo de las
--     últimas 24 horas, y certificados que vencen en 30 días o menos. Si no hay
--     nada, no se envía.
--
-- Todas son solo del servidor: security definer, search_path = public, sin
-- ejecución para PUBLIC, anon ni authenticated, y con ejecución para
-- service_role (el cron corre como postgres). Sin correo de soporte
-- configurado no se envía nada.

-- ---------------------------------------------------------------------------
-- 1. Sin cupo
-- ---------------------------------------------------------------------------
create or replace function public.ecf_avisar_sin_cupo(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to     text := (select nullif(btrim(support_email), '') from public.platform_settings limit 1);
  v_nombre text;
  v_cfg    public.ecf_config;
  v_uso    public.ecf_uso;
begin
  if v_to is null then
    return;
  end if;

  select name into v_nombre from public.companies where id = p_company;
  v_nombre := coalesce(v_nombre, 'una empresa');
  select * into v_cfg from public.ecf_config where company_id = p_company;
  select * into v_uso from public.ecf_uso
   where company_id = p_company and periodo = date_trunc('month', now() at time zone 'utc')::date;

  -- Una vez por empresa y mes: ecf-emitir llama por cada documento que se queda
  -- sin cupo, y send-lifecycle-email descarta las repeticiones por la clave.
  perform public._enviar_correo_plataforma(
    'ecf-avisos', v_to, p_company,
    'ecf-sin-cupo-' || p_company::text || '-' || to_char(now() at time zone 'utc', 'YYYYMM'),
    jsonb_build_object(
      'titulo', 'Urgente: ' || v_nombre || ' se quedó sin cupo de e-CF',
      'lineas', jsonb_build_array(
        'MSeller dejó de atender a ' || v_nombre || ' por falta de cupo (error 429): '
          || 'los comprobantes nuevos quedan en sin_cupo y no llegan a la DGII.',
        'Plan ' || coalesce(v_cfg.plan, 'sin configurar') || ': este mes lleva '
          || coalesce(v_uso.comprobantes, 0) || ' de ' || coalesce(v_cfg.cupo_comprobantes::text, '?')
          || ' comprobantes y ' || coalesce(v_uso.requests, 0) || ' de ' || coalesce(v_cfg.cupo_requests::text, '?')
          || ' requests.',
        'Se reintentan solos cuando cambie el plan en la configuración de e-CF de la empresa '
          || 'o cuando empiece el mes.')));
end;
$$;

revoke execute on function public.ecf_avisar_sin_cupo(uuid) from public, anon, authenticated;
grant execute on function public.ecf_avisar_sin_cupo(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Lo que merece atención hoy
-- ---------------------------------------------------------------------------
-- Las líneas del resumen diario, de todas las empresas, en este orden: cupo,
-- documentos y certificados. Es un arreglo JSON de textos (vacío si no hay
-- nada). Aparte del envío para poder revisarlas sin mandar un correo.
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
  cert as (
    -- Vence en 30 días o menos; uno ya vencido se sigue avisando cada día.
    select 3 as orden, e.name as empresa,
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
    from (select * from cupo union all select * from docs union all select * from cert) t;
$$;

revoke execute on function public._ecf_avisos_lineas() from public, anon, authenticated;
grant execute on function public._ecf_avisos_lineas() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Resumen diario
-- ---------------------------------------------------------------------------
-- Un solo correo al día; la clave 'ecf-avisos-<fecha>' evita repetirlo si el
-- cron corre dos veces. Sin nada que avisar no se manda.
create or replace function public.ecf_avisos_diarios()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to     text := (select nullif(btrim(support_email), '') from public.platform_settings limit 1);
  v_lineas jsonb;
begin
  if v_to is null then
    return;
  end if;
  v_lineas := public._ecf_avisos_lineas();
  if jsonb_array_length(v_lineas) = 0 then
    return;
  end if;

  perform public._enviar_correo_plataforma(
    'ecf-avisos', v_to, null, 'ecf-avisos-' || current_date::text,
    jsonb_build_object(
      'titulo', 'Avisos de e-CF del ' || to_char(current_date, 'DD/MM/YYYY'),
      'lineas', v_lineas));
end;
$$;

revoke execute on function public.ecf_avisos_diarios() from public, anon, authenticated;
grant execute on function public.ecf_avisos_diarios() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cron
-- ---------------------------------------------------------------------------
-- 8:00 a. m. en RD (UTC-4, sin horario de verano). Volver a programar el mismo
-- nombre reemplaza la tarea.
select cron.schedule('ecf-avisos', '0 12 * * *', $cron$select public.ecf_avisos_diarios()$cron$);
