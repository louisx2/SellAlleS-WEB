-- ============================================================================
-- e-CF: la empresa ve cuánto lleva usado de su cupo del mes
-- ============================================================================
-- ecf_uso solo lo lee el super admin (RLS). Para avisar al administrador de la
-- empresa antes de que se le acabe el cupo, esta función le devuelve SU uso del
-- mes, sin exponer la tabla ni el detalle interno de MSeller:
--
--   * comprobantes / cupo_comprobantes: lo que se le muestra ("212 de 250").
--   * uso_pct: el mayor % entre comprobantes y llamadas a la API. MSeller corta
--     con un 429 cuando se acaba cualquiera de los dos, así que el aviso se
--     dispara con el mayor; las llamadas no se le muestran (marca blanca).
--   * sin_cupo: documentos vigentes que ya se quedaron sin salir por falta de
--     cupo (sin los de ventas anuladas, igual que el banner de problemas).
--   * periodo: el día 1 del mes en UTC, que es cuando MSeller reinicia el cupo.
--
-- No recibe la empresa: usa current_company_id(), que ya resuelve la
-- impersonación del super admin. Sin e-CF activo no devuelve filas.
-- ============================================================================

create or replace function public.ecf_cupo_del_mes()
returns table (
  comprobantes       int,
  cupo_comprobantes  int,
  uso_pct            numeric,
  sin_cupo           int,
  periodo            date
)
language sql
stable
security definer
set search_path = public
as $$
  with mes as (
    select date_trunc('month', now() at time zone 'utc')::date as periodo
  )
  select coalesce(u.comprobantes, 0),
         c.cupo_comprobantes,
         greatest(
           case when c.cupo_comprobantes > 0
                then coalesce(u.comprobantes, 0) * 100.0 / c.cupo_comprobantes
                else case when coalesce(u.comprobantes, 0) > 0 then 100 else 0 end end,
           case when c.cupo_requests > 0
                then coalesce(u.requests, 0) * 100.0 / c.cupo_requests
                else case when coalesce(u.requests, 0) > 0 then 100 else 0 end end
         )::numeric,
         (select count(*)::int
            from public.ecf_documentos d
            left join public.sales s on s.id = d.sale_id
           where d.company_id = c.company_id
             and d.estado = 'sin_cupo'
             and d.reemplazado_por is null
             and s.cancelled_at is null),
         (select periodo from mes)
    from public.ecf_config c
    left join public.ecf_uso u
           on u.company_id = c.company_id
          and u.periodo = (select periodo from mes)
   where c.company_id = public.current_company_id()
     and public.ecf_activa(c.company_id);
$$;

comment on function public.ecf_cupo_del_mes() is
  'Uso del cupo mensual de e-CF de la empresa actual (comprobantes, % mayor entre comprobantes y llamadas, documentos sin cupo). Para el aviso del administrador.';

revoke all on function public.ecf_cupo_del_mes() from public, anon;
grant execute on function public.ecf_cupo_del_mes() to authenticated, service_role;
