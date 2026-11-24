-- Motopréstamos 2C: custodia por defecto, exigir garante y la moto en el portal.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 2)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-2c-contrato-config-fotos-portal.md (Task 2)
--
-- Cambia dos funciones vivas, partiendo de pg_get_functiondef:
--   motos_vincular_venta      7d023a032aad10b82e689fecbefdfa86
--   resolve_portal_customers  8a2ba6c4bd61420b5bf68df4bcb79b96
-- Sin fila en motos_settings todo queda como en 2A/2B.
-- Pruebas: supabase/tests/motos_ajustes.sql

-- 1. Los ajustes de una empresa, o los valores por defecto ---------------------------

create or replace function public.motos_ajuste(p_company uuid)
returns public.motos_settings
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s from public.motos_settings s where s.company_id = p_company),
    (p_company, true, false, true, false, null::text, null::text, now())::public.motos_settings);
$$;

-- 2. Vender una moto: custodia según los ajustes y garante si se exige ----------------

create or replace function public.motos_vincular_venta(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale    public.sales%rowtype;
  r         record;
  v         public.vehicles%rowtype;
  v_aj      public.motos_settings;
  v_a_plazo boolean;
begin
  if not exists (select 1 from public.sale_items where sale_id = p_sale_id and vehicle_id is not null) then
    return;
  end if;

  -- La llama create_sale_with_items como el usuario (por eso authenticated la
  -- puede ejecutar): solo actúa sobre una venta vigente de su empresa.
  select * into v_sale from public.sales where id = p_sale_id;
  if not found or (v_sale.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;
  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;
  if v_sale.customer_id is null then
    raise exception 'Para vender un vehículo elige el cliente.';
  end if;
  if exists (
    select 1 from public.sale_items
     where sale_id = p_sale_id and vehicle_id is not null
     group by vehicle_id having count(*) > 1
  ) then
    raise exception 'El mismo vehículo está dos veces en la venta.';
  end if;

  v_aj := public.motos_ajuste(v_sale.company_id);
  v_a_plazo := v_sale.payment_status::text in ('credit', 'in_financing');
  if v_a_plazo and v_aj.require_guarantor
     and not exists (select 1 from public.customer_guarantors g where g.customer_id = v_sale.customer_id) then
    raise exception 'Este cliente no tiene garante y el negocio lo exige para financiar o prestar. Agrégalo en el expediente del cliente.';
  end if;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'venta', true);

  for r in
    select si.* from public.sale_items si
     where si.sale_id = p_sale_id and si.vehicle_id is not null
     order by si.id
  loop
    -- Bloqueada: dos cajas vendiendo el mismo chasis, la segunda espera y falla.
    select * into v from public.vehicles where id = r.vehicle_id for update;
    if not found or v.company_id <> v_sale.company_id then
      raise exception 'Vehículo no encontrado.';
    end if;
    if v.status <> 'disponible' then
      raise exception 'El vehículo con chasis % no está disponible.', coalesce(v.chassis, '(sin chasis)');
    end if;
    if v.branch_id <> v_sale.branch_id or v.product_id is distinct from r.product_id then
      raise exception 'El vehículo no corresponde a ese artículo en esta sucursal.';
    end if;
    if r.quantity <> 1 or r.presentation_id is not null then
      raise exception 'Cada vehículo se vende en su propia línea, con cantidad 1.';
    end if;

    update public.vehicles
       set status = 'vendido',
           customer_id = v_sale.customer_id,
           sale_id = v_sale.id,
           -- A plazo, la matrícula queda guardada hasta saldar (salvo que el negocio
           -- no la retenga); de contado se entrega, o queda lista para entregar si
           -- el negocio la tramita y la guarda.
           registration_status = case
             when v_a_plazo then case when v_aj.custody_financed_sale then 'en_custodia' else 'entregada' end
             else case when v_aj.custody_cash_sale then 'lista_para_entregar' else 'entregada' end
           end,
           registration_since = now()
     where id = v.id;

    -- La línea lleva el costo de ESA unidad y su descripción (chasis y motor en
    -- la factura).
    update public.sale_items
       set cost = coalesce(v.cost, cost),
           product_name = public.motos_descripcion(v)
     where id = r.id;
  end loop;

  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
end;
$$;

-- 3. Prestar: garante si se exige -------------------------------------------------------
-- Para todo préstamo nuevo de una empresa con el módulo y el ajuste encendidos,
-- salvo el que crea una refinanciación (el cliente ya tenía su préstamo).

create or replace function public.motos_exigir_garante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refinanced_from_id is null
     and exists (select 1 from public.motos_settings s where s.company_id = new.company_id and s.require_guarantor)
     and public.is_module_enabled(new.company_id, 'motoprestamos', false)
     and not exists (select 1 from public.customer_guarantors g where g.customer_id = new.customer_id) then
    raise exception 'Este cliente no tiene garante y el negocio lo exige para financiar o prestar. Agrégalo en el expediente del cliente.';
  end if;
  return new;
end;
$$;

create trigger trg_motos_exigir_garante before insert on public.loans
  for each row execute function public.motos_exigir_garante();

-- 4. Portal: la moto de cada préstamo o venta y las matrículas listas ----------------

create or replace function public.resolve_portal_customers(p_cedula text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'companyId', c.id,
    'companyName', c.name,
    'customerId', cu.id,
    -- Solo el fallback de los contratos sin política congelada; cada venta y
    -- cada préstamo traen la suya más abajo.
    'lateFeeRate', coalesce(c.late_fee_rate, 5),
    'lateFeeGraceDays', coalesce(c.late_fee_grace_days, 0),
    'loanLateFeeRate', coalesce(c.loan_late_fee_rate, 5),
    'loanLateFeeGraceDays', coalesce(c.loan_late_fee_grace_days, 0),
    -- Motopréstamos: matrículas del cliente listas para retirar (la venta saldada
    -- ya no sale abajo).
    'registrationsReady', (
      select coalesce(jsonb_agg(jsonb_build_object('brand', v.brand, 'model', v.model, 'plate', v.plate)
                                order by v.registration_since), '[]'::jsonb)
      from vehicles v
      where v.customer_id = cu.id and v.registration_status = 'lista_para_entregar'
    ),
    'loans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'branchId', l.branch_id,
        'customerId', l.customer_id,
        'principal', l.principal,
        'interestRate', l.interest_rate,
        'installmentsCount', l.installments_count,
        'paymentFrequency', l.payment_frequency,
        'totalWithInterest', l.total_with_interest,
        'amountPaid', l.amount_paid,
        'status', l.status,
        'notes', l.notes,
        'createdAt', l.created_at,
        'lateFeeRate', l.late_fee_rate,
        'lateFeeMode', l.late_fee_mode,
        'lateFeeGraceDays', l.late_fee_grace_days,
        'lateFeeMaxRate', l.late_fee_max_rate,
        'installments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', li.id, 'loanId', li.loan_id, 'number', li.installment_number,
            'dueDate', li.due_date, 'amount', li.amount, 'paidAmount', li.paid_amount,
            'lateFeePaid', li.late_fee_paid, 'status', li.status, 'paidAt', li.paid_at
          ) order by li.installment_number), '[]'::jsonb)
          from loan_installments li where li.loan_id = l.id
        ),
        'payments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', lp.id, 'loanId', lp.loan_id, 'amount', lp.amount,
            'lateFeePaid', lp.late_fee_paid, 'method', lp.method,
            'notes', lp.notes, 'date', lp.date
          ) order by lp.date desc), '[]'::jsonb)
          from loan_payments lp where lp.loan_id = l.id
        ),
        'vehicles', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'brand', v.brand, 'model', v.model, 'plate', v.plate, 'registrationStatus', v.registration_status
          )), '[]'::jsonb)
          from vehicles v where v.loan_id = l.id
        )
      )), '[]'::jsonb)
      from loans l where l.customer_id = cu.id
    ),
    'creditSales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'subtotal', s.subtotal,
        'itbisAmount', s.itbis_amount,
        'total', s.total,
        'paymentMethod', s.payment_method,
        'paymentStatus', s.payment_status,
        'amountPaid', s.amount_paid,
        'createdAt', s.created_at,
        'financingDetails', s.financing_details,
        'installments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', fi.id, 'saleId', fi.sale_id, 'number', fi.installment_number,
            'dueDate', fi.due_date, 'amount', fi.amount, 'paidAmount', fi.paid_amount,
            'lateFeePaid', fi.late_fee_paid, 'status', fi.status, 'paidAt', fi.paid_at
          ) order by fi.installment_number), '[]'::jsonb)
          from financing_installments fi where fi.sale_id = s.id
        ),
        'payments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', cp.id, 'saleId', cp.sale_id, 'amount', cp.amount,
            'lateFeePaid', cp.late_fee_paid, 'method', cp.method,
            'notes', cp.notes, 'date', cp.date
          ) order by cp.date desc), '[]'::jsonb)
          from credit_payments cp where cp.sale_id = s.id
        ),
        'vehicles', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'brand', v.brand, 'model', v.model, 'plate', v.plate, 'registrationStatus', v.registration_status
          )), '[]'::jsonb)
          from vehicles v where v.sale_id = s.id
        )
      )), '[]'::jsonb)
      from sales s where s.customer_id = cu.id and s.payment_status in ('credit','in_financing')
    )
  )), '[]'::jsonb)
  from customers cu
  join companies c on c.id = cu.company_id
  where cu.rnc = p_cedula
    and public.is_module_enabled(c.id, 'customer-portal', false);
$$;

-- 5. Grants ------------------------------------------------------------------------------
-- motos_ajuste lee los ajustes de cualquier empresa: solo para las funciones del
-- sistema. El front lee la tabla con su RLS.
revoke execute on function public.motos_ajuste(uuid) from public, anon, authenticated;
grant execute on function public.motos_ajuste(uuid) to service_role;
revoke execute on function public.motos_exigir_garante() from public, anon, authenticated;
grant execute on function public.motos_exigir_garante() to service_role;
