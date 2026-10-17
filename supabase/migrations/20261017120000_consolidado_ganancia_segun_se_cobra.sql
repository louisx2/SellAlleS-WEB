-- Consolidado: la ganancia de lo vendido a plazos cuenta según se cobra.
--
-- get_consolidated_dashboard sumaba el margen ENTERO de cada venta a crédito o
-- financiada el día que se hacía, aunque el cliente no hubiera pagado nada.
-- Ahora usa la misma regla que /reports/ganancias (src/lib/ganancia-realizada.ts):
-- las de contado cuentan enteras el día de la venta; las de crédito y las
-- financiadas, la parte de mercancía que cubre cada abono, el día del abono.
--
-- De paso, las ventas anuladas dejan de contar como ingreso, venta y costo, y
-- las líneas de venta rápida sin costo salen del ingreso de la ganancia, igual
-- que en el resto de los reportes.
--
-- Sin cambios de firma: la pantalla del consolidado sigue leyendo las mismas
-- columnas (subtotal_revenue y cogs ahora son lo realizado en el rango).
--
-- Requisito: 20261016200000_ventas_rapidas.sql (sale_items.is_quick).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sale_items' and column_name = 'is_quick') then
    raise exception 'Falta aplicar 20261016200000_ventas_rapidas.sql antes de esta migración.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. _ventas_cobradas: cada venta de una sucursal partida en lo que ya se cobró,
--    con la fecha del cobro. Réplica en SQL de realizaciones() del front; si se
--    cambia una, hay que cambiar la otra. `subtotal` y `costo` son los de la
--    venta entera para la ganancia (ingresoDeVenta/costoDeVenta del reporte).
-- ---------------------------------------------------------------------------
create or replace function public._ventas_cobradas(p_branch_id uuid, p_date_from date default null, p_date_to date default null)
 returns table(sale_id uuid, fecha timestamptz, fraccion numeric, subtotal numeric, costo numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  with ventas as (
    select s.id, s.created_at, s.subtotal, s.total, s.amount_paid, s.itbis_included,
      (s.payment_method::text in ('credit','financing')
        or s.payment_status::text in ('credit','in_financing')) and s.total > 0 as a_plazo,
      -- Solo un financiamiento con plan lleva interés. El inicial no lo lleva.
      case when s.payment_method::text = 'financing' and s.financing_details ? 'totalWithInterest'
           then coalesce((s.financing_details->>'downPayment')::numeric, 0) else 0 end as inicial,
      case when s.payment_method::text = 'financing' and s.financing_details ? 'totalWithInterest'
           then (s.financing_details->>'totalWithInterest')::numeric end as con_interes
    from sales s
    where s.branch_id = p_branch_id and s.cancelled_at is null
  ),
  plazo as (
    -- amount_paid de un financiamiento cuenta capital + interés (sin mora):
    -- la parte de interés de lo abonado al plan es interés / (plan entero).
    select v.*,
      case when v.con_interes is not null and v.con_interes - v.inicial > 0
           then greatest(v.con_interes - v.total, 0) / (v.con_interes - v.inicial) else 0 end as parte_interes
    from ventas v
    where v.a_plazo
  ),
  cobrado as (
    select p.*,
      least(
        least(greatest(p.amount_paid, 0), p.inicial)
          + (greatest(p.amount_paid, 0) - least(greatest(p.amount_paid, 0), p.inicial)) * (1 - p.parte_interes),
        p.total) as mercancia_cobrada
    from plazo p
  ),
  abonos as (
    -- Capital (sin mora) que recibió cada venta, abono por abono: por sale_id,
    -- o por el reparto que guardó un abono general.
    select cp.sale_id, cp.date, cp.amount - cp.late_fee_paid as capital, cp.kind = 'down_payment' as es_inicial
    from credit_payments cp
    where cp.company_id = (select b.company_id from branches b where b.id = p_branch_id)
      and cp.voided_at is null and cp.sale_id is not null
      and case when jsonb_typeof(cp.allocation->'sales') = 'array'
               then jsonb_array_length(cp.allocation->'sales') else 0 end = 0
    union all
    select (x->>'sale_id')::uuid, cp.date, (x->>'principal')::numeric, cp.kind = 'down_payment'
    from credit_payments cp
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cp.allocation->'sales') = 'array' then cp.allocation->'sales' else '[]'::jsonb end) x
    where cp.company_id = (select b.company_id from branches b where b.id = p_branch_id)
      and cp.voided_at is null
    -- Un abono general sin reparto (los de antes del 2026-08-31) no dice a qué
    -- venta fue: lo que cubrió entra abajo como cobrado sin fecha.
  ),
  piezas as (
    select c.id, a.date as fecha,
      case when a.es_inicial then a.capital else a.capital * (1 - c.parte_interes) end as mercancia
    from cobrado c join abonos a on a.sale_id = c.id
    where a.capital > 0
  ),
  sin_fecha as (
    -- Lo que la base da por cobrado sin un abono con fecha que lo respalde
    -- (iniciales viejos, ventas del legado) se reconoce el día de la venta.
    select c.id, c.created_at as fecha, c.mercancia_cobrada - coalesce(sum(p.mercancia), 0) as mercancia
    from cobrado c left join piezas p on p.id = c.id
    group by c.id, c.created_at, c.mercancia_cobrada
    having c.mercancia_cobrada - coalesce(sum(p.mercancia), 0) > 0.01
  ),
  topadas as (
    -- Nunca más que el total de la venta, en orden de fecha.
    select t.id, t.fecha,
      least(t.mercancia, c.total - coalesce(sum(t.mercancia) over (
        partition by t.id order by t.fecha rows between unbounded preceding and 1 preceding), 0)) as mercancia
    from (select * from piezas union all select * from sin_fecha) t
    join cobrado c on c.id = t.id
  ),
  filas as (
    select c.id, t.fecha, t.mercancia / c.total as fraccion, c.subtotal, c.itbis_included
    from topadas t join cobrado c on c.id = t.id
    where t.mercancia > 0
      and (p_date_from is null or t.fecha::date >= p_date_from)
      and (p_date_to is null or t.fecha::date <= p_date_to)
    union all
    select v.id, v.created_at, 1::numeric, v.subtotal, v.itbis_included
    from ventas v
    where not v.a_plazo
      and (p_date_from is null or v.created_at::date >= p_date_from)
      and (p_date_to is null or v.created_at::date <= p_date_to)
  )
  -- Una línea rápida sin costo no tiene con qué calcular su ganancia: sale del
  -- ingreso (su base sin ITBIS) y no suma costo. Misma cuenta que lineBase() del
  -- front: el 18% (ITBIS_RATE) se quita solo si la línea lo lleva dentro.
  select f.id, f.fecha, f.fraccion, f.subtotal - l.rapidas_sin_costo, l.costo
  from filas f
  cross join lateral (
    select coalesce(sum(si.quantity * si.cost), 0) as costo,
      coalesce(sum(round(
        case when coalesce(si.itbis, false) and coalesce(f.itbis_included, false)
             then si.quantity * coalesce(si.custom_price, si.price) / 1.18
             else si.quantity * coalesce(si.custom_price, si.price) end, 2))
        filter (where si.is_quick and si.cost is null), 0) as rapidas_sin_costo
    from sale_items si
    where si.sale_id = f.id
  ) l;
$function$;

-- Pieza interna: la llaman las RPC, no el cliente.
revoke all on function public._ventas_cobradas(uuid, date, date) from public;
revoke execute on function public._ventas_cobradas(uuid, date, date) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_consolidated_dashboard: la definición viva (volcada el 2026-10-16).
--    Cambia solo sagg (sin anuladas) y cagg (ahora lo cobrado en el rango).
-- ---------------------------------------------------------------------------
create or replace function public.get_consolidated_dashboard(p_date_from date default null::date, p_date_to date default null::date)
 returns table(company_id uuid, company_name text, branch_id uuid, branch_name text, revenue numeric, subtotal_revenue numeric, cogs numeric, sales_count bigint, expenses numeric, receivables_pending numeric, inventory_cost_value numeric, inventory_units numeric, loans_balance numeric, loans_active_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with my_companies as (
    select pc.company_id from public.profile_companies pc
    where pc.profile_id = auth.uid() and pc.role = 'admin'
  ),
  branch_rows as (
    select
      c.id as company_id, c.name as company_name, b.id as branch_id, b.name as branch_name,
      coalesce(sagg.revenue,0) as revenue, coalesce(cagg.subtotal_revenue,0) as subtotal_revenue,
      coalesce(cagg.cogs,0) as cogs, coalesce(sagg.sales_count,0) as sales_count,
      coalesce(eagg.expenses,0) as expenses, coalesce(rec.receivables_pending,0) as receivables_pending,
      0::numeric as inventory_cost_value, 0::numeric as inventory_units,
      coalesce(lagg.loans_balance,0) as loans_balance, coalesce(lagg.loans_active_count,0) as loans_active_count
    from my_companies mc
    join public.companies c on c.id = mc.company_id
    join public.branches b on b.company_id = c.id
    left join lateral (
      select sum(s.total) revenue, count(*) sales_count
      from public.sales s
      where s.branch_id = b.id and s.cancelled_at is null
        and (p_date_from is null or s.created_at::date >= p_date_from)
        and (p_date_to is null or s.created_at::date <= p_date_to)
    ) sagg on true
    -- Ganancia de la mercancía: lo cobrado en el rango. Una venta a plazos
    -- aporta subtotal y costo en la proporción que se pagó, el día del abono.
    left join lateral (
      select sum(vc.subtotal * vc.fraccion) subtotal_revenue, sum(vc.costo * vc.fraccion) cogs
      from public._ventas_cobradas(b.id, p_date_from, p_date_to) vc
    ) cagg on true
    left join lateral (
      select sum(e.amount) expenses from public.expenses e
      where e.branch_id = b.id
        and (p_date_from is null or e.date::date >= p_date_from)
        and (p_date_to is null or e.date::date <= p_date_to)
    ) eagg on true
    -- Cuentas por cobrar: saldo ACTUAL pendiente, sin filtro de fecha (igual
    -- que /reports/receivables, que tampoco tiene selector de fechas).
    left join lateral (
      select sum(greatest(s3.total - s3.amount_paid, 0)) receivables_pending
      from public.sales s3
      where s3.branch_id = b.id and s3.payment_status in ('credit','in_financing')
    ) rec on true
    left join lateral (
      select sum(greatest(l.total_with_interest - l.amount_paid, 0)) loans_balance, count(*) loans_active_count
      from public.loans l where l.branch_id = b.id and l.status = 'active'
    ) lagg on true
  ),
  inventory_rows as (
    select c.id as company_id, c.name as company_name, null::uuid as branch_id, null::text as branch_name,
           0::numeric as revenue, 0::numeric as subtotal_revenue, 0::numeric as cogs, 0::bigint as sales_count,
           0::numeric as expenses, 0::numeric as receivables_pending,
           coalesce(sum(p.stock * p.cost), 0) as inventory_cost_value, coalesce(sum(p.stock), 0) as inventory_units,
           0::numeric as loans_balance, 0::bigint as loans_active_count
    from my_companies mc
    join public.companies c on c.id = mc.company_id
    left join public.products p on p.company_id = c.id
    group by c.id, c.name
  )
  select * from branch_rows
  union all
  select * from inventory_rows;
$function$;

-- Sin sesión no devuelve nada (auth.uid() es null), pero anon no tiene por qué
-- poder llamarla.
revoke execute on function public.get_consolidated_dashboard(date, date) from anon;
