-- Motopréstamos 3B: enlaces de recibos de abono, plantillas de WhatsApp y reporte
-- de cobranza.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 3)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-3b-recibos-avisos-reportes.md (Task 1)
--
-- No cambia ninguna función viva. Amplía la lectura de entregas y cartera a quien ve
-- los reportes y agrega un trigger en los abonos (al anular, borra el enlace del
-- recibo). `receipt_links` deja de exigir venta: un enlace es de una venta o de un
-- abono (la función `c` solo lee la ruta del archivo, así que no cambia).
-- `motos_ajuste` lee los ajustes por nombre: las columnas nuevas no la rompen.
-- Pruebas: supabase/tests/cobranza.sql (§4)

-- 1. Enlaces de recibos de abono ----------------------------------------------------------

alter table public.receipt_links
  alter column sale_id drop not null,
  add column loan_payment_id   uuid references public.loan_payments(id) on delete cascade,
  add column credit_payment_id uuid references public.credit_payments(id) on delete cascade,
  add constraint receipt_links_un_documento
    check (num_nonnulls(sale_id, loan_payment_id, credit_payment_id) = 1);
create index receipt_links_loan_payment_idx on public.receipt_links(loan_payment_id) where loan_payment_id is not null;
create index receipt_links_credit_payment_idx on public.receipt_links(credit_payment_id) where credit_payment_id is not null;

-- 2. Plantillas de WhatsApp (vacío = el texto base del front) ------------------------------

alter table public.motos_settings
  add column whatsapp_reminder text,
  add column whatsapp_receipt  text;

-- 3. Reporte de cobranza por cobrador ------------------------------------------------------
-- Por cobrar: cuotas (pagadas o no) que vencían en el período, de los clientes de la
-- cartera actual. Cobrado: abonos no anulados del cobrador con fecha local en el período.
-- Promesa cumplida: el cliente abonó (sin anular) en la sucursal desde el momento de la
-- visita hasta el día de la promesa —un abono anterior a la visita, aunque sea del mismo
-- día, no la cumple («pagó una parte y prometió el resto»)—; solo cuentan las ya
-- vencidas. Las fechas son locales, en la zona de la empresa (como company_today).

create or replace function public.cobranza_reporte(p_branch_id uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_tz      text;
  v_hoy     date;
  v_res     jsonb;
begin
  select b.company_id, coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo')
    into v_company, v_tz
    from public.branches b join public.companies c on c.id = b.company_id
   where b.id = p_branch_id;
  if v_company is null or (v_company <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Sucursal no encontrada.';
  end if;
  if not (public.is_company_admin() or public.is_super_admin()
          or public.cobranza_tengo_permiso(p_branch_id, 'cobranza-all', 'view')
          or public.cobranza_tengo_permiso(p_branch_id, 'reports', 'view')) then
    raise exception 'No tienes permiso para ver los reportes de cobranza.';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Período no válido.';
  end if;
  v_hoy := public.company_today(v_company);

  with cuotas as (
    select l.customer_id, li.due_date, li.amount,
           (li.status <> 'paid' and l.status = 'active') as abierta
      from public.loans l join public.loan_installments li on li.loan_id = l.id
     where l.branch_id = p_branch_id and l.status <> 'cancelled'
    union all
    select s.customer_id, fi.due_date, fi.amount,
           (fi.status <> 'paid' and s.payment_status::text <> 'paid') as abierta
      from public.sales s join public.financing_installments fi on fi.sale_id = s.id
     where s.branch_id = p_branch_id and s.cancelled_at is null and s.customer_id is not null
  ),
  por_cliente as (
    select customer_id,
           coalesce(sum(amount) filter (where due_date between p_desde and p_hasta), 0) as por_cobrar,
           bool_or(abierta and due_date < v_hoy) as atrasado
      from cuotas
     group by customer_id
  ),
  cartera as (
    select a.customer_id, a.collector_id
      from public.collection_assignments a
     where a.branch_id = p_branch_id
  ),
  abonos as (
    select collector_id, customer_id, amount, method, en_calle, settlement_id, voided_at, date,
           timezone(v_tz, date)::date as dia
      from public.loan_payments where branch_id = p_branch_id
    union all
    select collector_id, customer_id, amount, method, en_calle, settlement_id, voided_at, date,
           timezone(v_tz, date)::date as dia
      from public.credit_payments where branch_id = p_branch_id
  ),
  promesas as (
    select v.collector_id,
           exists (select 1 from abonos ab
                    where ab.customer_id = v.customer_id and ab.voided_at is null
                      and ab.date >= v.created_at and ab.dia <= v.promise_date) as cumplida
      from public.collection_visits v
     where v.branch_id = p_branch_id and v.outcome = 'promesa'
       and v.promise_date between p_desde and p_hasta and v.promise_date < v_hoy
  ),
  filas as (
    select c.id as collector_id,
           coalesce(pr.name, 'Cobrador') as nombre,
           c.is_active,
           (select round(coalesce(sum(pc.por_cobrar), 0), 2)
              from cartera ca join por_cliente pc on pc.customer_id = ca.customer_id
             where ca.collector_id = c.id) as por_cobrar,
           (select round(coalesce(sum(ab.amount), 0), 2) from abonos ab
             where ab.collector_id = c.id and ab.voided_at is null and ab.dia between p_desde and p_hasta) as cobrado,
           (select count(*) from public.collection_visits v
             where v.collector_id = c.id and v.branch_id = p_branch_id
               and timezone(v_tz, v.created_at)::date between p_desde and p_hasta) as visitas,
           (select count(*) from promesas p where p.collector_id = c.id and p.cumplida) as promesas_cumplidas,
           (select count(*) from promesas p where p.collector_id = c.id and not p.cumplida) as promesas_incumplidas,
           (select count(*) from cartera ca join por_cliente pc on pc.customer_id = ca.customer_id
             where ca.collector_id = c.id and pc.atrasado) as atrasados,
           (select round(coalesce(sum(ab.amount), 0), 2) from abonos ab
             where ab.collector_id = c.id and ab.method = 'cash' and ab.en_calle
               and ab.settlement_id is null and ab.voided_at is null) as en_mano,
           (select min(ab.dia) from abonos ab
             where ab.collector_id = c.id and ab.method = 'cash' and ab.en_calle
               and ab.settlement_id is null and ab.voided_at is null) as en_mano_desde
      from public.collectors c
      left join public.profiles pr on pr.id = c.profile_id
     where c.branch_id = p_branch_id
  )
  select jsonb_build_object(
    'cobradores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'collector_id', f.collector_id, 'nombre', f.nombre, 'por_cobrar', f.por_cobrar,
               'cobrado', f.cobrado, 'visitas', f.visitas, 'promesas_cumplidas', f.promesas_cumplidas,
               'promesas_incumplidas', f.promesas_incumplidas, 'atrasados', f.atrasados,
               'en_mano', f.en_mano, 'en_mano_desde', f.en_mano_desde)
             order by f.nombre)
        from filas f
       where f.is_active or f.por_cobrar > 0 or f.cobrado > 0 or f.visitas > 0 or f.en_mano > 0), '[]'::jsonb),
    'sin_asignar', (
      select jsonb_build_object(
               'por_cobrar', round(coalesce(sum(pc.por_cobrar), 0), 2),
               'atrasados', count(*) filter (where pc.atrasado))
        from por_cliente pc
       where not exists (select 1 from cartera ca where ca.customer_id = pc.customer_id))
  ) into v_res;

  return v_res;
end;
$$;

-- 4. Quien ve los reportes lee las entregas y la cartera de la sucursal -------------------
-- Cuadres y Antigüedad por cobrador las leen directo; sin esto, un rol con solo
-- Reportes veía tablas vacías. Escribir sigue pidiendo los permisos de cobranza.

drop policy collector_settlements_select on public.collector_settlements;
create policy collector_settlements_select on public.collector_settlements
  for select using (
    (company_id = public.current_company_id()
     and (collector_id = public.cobranza_mi_cobrador(branch_id)
          or public.cobranza_tengo_permiso(branch_id, 'cobranza-cuadre', 'view')
          or public.cobranza_tengo_permiso(branch_id, 'reports', 'view')))
    or public.is_super_admin());

drop policy collection_assignments_select on public.collection_assignments;
create policy collection_assignments_select on public.collection_assignments
  for select using (
    (company_id = public.current_company_id()
     and (collector_id = public.cobranza_mi_cobrador(branch_id)
          or public.cobranza_tengo_permiso(branch_id, 'cobranza-all', 'view')
          or public.cobranza_tengo_permiso(branch_id, 'reports', 'view')))
    or public.is_super_admin());

-- 5. Anular un abono borra el enlace de su recibo ------------------------------------------
-- La función `c` responde «Enlace no encontrado»: el cliente no se queda con el
-- comprobante de un abono que ya no vale.

create or replace function public.cobranza_borrar_enlaces_de_anulado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'loan_payments' then
    delete from public.receipt_links where loan_payment_id = new.id;
  else
    delete from public.receipt_links where credit_payment_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_enlaces_de_abono_anulado after update of voided_at on public.loan_payments
  for each row when (old.voided_at is null and new.voided_at is not null)
  execute function public.cobranza_borrar_enlaces_de_anulado();
create trigger trg_enlaces_de_abono_anulado after update of voided_at on public.credit_payments
  for each row when (old.voided_at is null and new.voided_at is not null)
  execute function public.cobranza_borrar_enlaces_de_anulado();

-- 6. Grants -------------------------------------------------------------------------------

revoke execute on function public.cobranza_reporte(uuid, date, date) from public, anon;
grant execute on function public.cobranza_reporte(uuid, date, date) to authenticated, service_role;
revoke execute on function public.cobranza_borrar_enlaces_de_anulado() from public, anon, authenticated;
grant execute on function public.cobranza_borrar_enlaces_de_anulado() to service_role;
