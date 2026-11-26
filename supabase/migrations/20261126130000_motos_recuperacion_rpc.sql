-- Motopréstamos 4A: incautar, devolver y liquidar la garantía, y recuperar la moto vendida.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 4)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-4a-recuperacion.md (Task 2)
--
-- Cambia dos funciones vivas, partiendo de pg_get_functiondef (solo las líneas
-- necesarias):
--   register_loan_payment  5191136b96dc7d1688cb463348b7ec95  (acepta `dacion` solo con app.motos_dacion = on)
--   void_loan_payment      versión de 3A (20261125130000)     (no anula una dación en pago)
-- Lee, sin cambiarlas: vehicles_before, vehicles_after, motos_prestamo_estado,
-- motos_venta_saldada y recompute_customer_balance.
--
-- La moto cambia de estado como en 2B: motos.sistema = si, motos.evento (el tipo
-- del evento de la ficha) y motos.nota. Pruebas: supabase/tests/motos_recuperacion.sql

-- 1. Abonos: la dación en pago solo entra por la liquidación ---------------------------------

create or replace function public.register_loan_payment(p_loan_id uuid, p_amount numeric, p_method text, p_branch_id uuid default null::uuid, p_notes text default null::text, p_reference text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_loan          public.loans%rowtype;
  v_late_rate     numeric;
  v_late_mode     text;
  v_grace         int;
  v_max_rate      numeric;
  v_period_days   int;
  v_today         date;
  v_total_due     numeric;
  v_late_due      numeric := 0;
  v_late_collect  numeric := 0;
  v_capital       numeric := 0;
  v_remaining     numeric;
  v_inst          record;
  v_apply         numeric;
  v_fee_due       numeric;
  v_payment_id    uuid;
  v_user_name     text;
  v_paid_count    int := 0;
  v_total_count   int := 0;
  v_insts         jsonb := '[]'::jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  -- `dacion` (el negocio se queda la moto en garantía) solo lo usa motos_liquidar_garantia.
  if p_method not in ('cash','card','transfer')
     and not (p_method = 'dacion' and coalesce(current_setting('app.motos_dacion', true), '') = 'on') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'Préstamo no encontrado.';
  end if;
  if not (is_super_admin() or (v_loan.company_id = current_company_id()
          and (is_company_admin()
               or v_loan.branch_id in (select user_branch_ids())
               or branch_shares_with_me('prestamos', v_loan.branch_id)))) then
    raise exception 'No tienes acceso a este préstamo.';
  end if;
  if v_loan.status = 'paid' then
    raise exception 'Este préstamo ya está saldado.';
  end if;
  if v_loan.status = 'refinanced' then
    raise exception 'Este préstamo fue refinanciado: cobra el préstamo nuevo.';
  end if;

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_loan.company_id;
    if not found then
      raise exception 'Sucursal no válida para este préstamo.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_loan.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  -- La política congelada del préstamo manda. Los préstamos anteriores a la
  -- mora configurable no traen ninguna y caen a la de la empresa en modo once:
  -- exactamente como se les venía cobrando.
  select coalesce(v_loan.late_fee_rate, c.loan_late_fee_rate, 5),
         coalesce(nullif(v_loan.late_fee_mode, ''), 'once'),
         coalesce(v_loan.late_fee_grace_days, c.loan_late_fee_grace_days, 0),
         coalesce(v_loan.late_fee_max_rate, 0)
    into v_late_rate, v_late_mode, v_grace, v_max_rate
    from public.companies c where c.id = v_loan.company_id;

  v_period_days := late_fee_period_days(v_loan.payment_frequency);
  v_today       := company_today(v_loan.company_id);

  v_total_due := v_loan.total_with_interest - v_loan.amount_paid;

  perform 1 from public.loan_installments where loan_id = p_loan_id for update;

  select coalesce(sum(late_fee_due(amount, paid_amount, late_fee_paid, due_date, v_today,
                                   v_late_rate, v_late_mode, v_grace, v_max_rate, v_period_days)), 0)
    into v_late_due
    from public.loan_installments
   where loan_id = p_loan_id and status <> 'paid';

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'), to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_remaining := p_amount;

  -- 1) La mora primero.
  for v_inst in
    select * from public.loan_installments
     where loan_id = p_loan_id and status <> 'paid' and due_date + v_grace < v_today
     order by installment_number
  loop
    exit when v_remaining <= 0;
    v_fee_due := late_fee_due(v_inst.amount, v_inst.paid_amount, v_inst.late_fee_paid,
                              v_inst.due_date, v_today,
                              v_late_rate, v_late_mode, v_grace, v_max_rate, v_period_days);
    if v_fee_due > 0 then
      v_apply := least(v_remaining, v_fee_due);
      update public.loan_installments set late_fee_paid = late_fee_paid + v_apply where id = v_inst.id;
      v_late_collect := v_late_collect + v_apply;
      v_remaining := v_remaining - v_apply;
      v_insts := v_insts || jsonb_build_object(
        'id', v_inst.id, 'number', v_inst.installment_number, 'principal', 0, 'late_fee', v_apply);
    end if;
  end loop;

  -- 2) Capital FIFO, sin pasarse de la deuda.
  v_remaining := least(v_remaining, greatest(round(v_total_due, 2), 0));

  for v_inst in
    select * from public.loan_installments
     where loan_id = p_loan_id and status <> 'paid'
     order by installment_number
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_inst.amount - v_inst.paid_amount);
    if v_apply > 0 then
      update public.loan_installments
         set paid_amount = paid_amount + v_apply,
             status  = case when paid_amount + v_apply >= amount - 0.005 then 'paid' else 'partial' end,
             paid_at = case when paid_amount + v_apply >= amount - 0.005 then now() else paid_at end
       where id = v_inst.id;
      v_remaining := v_remaining - v_apply;
      v_capital   := v_capital + v_apply;
      v_insts := v_insts || jsonb_build_object(
        'id', v_inst.id, 'number', v_inst.installment_number, 'principal', v_apply, 'late_fee', 0);
    end if;
  end loop;

  select name into v_user_name from public.profiles where id = auth.uid();

  insert into public.loan_payments
    (company_id, loan_id, customer_id, branch_id, amount, late_fee_paid, method,
     reference, notes, user_id, user_name, date, allocation)
  values
    (v_loan.company_id, v_loan.id, v_loan.customer_id, p_branch_id, p_amount, v_late_collect,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now(),
     jsonb_build_object('installments', v_insts, 'principal', v_capital, 'late_fee', v_late_collect))
  returning id into v_payment_id;

  update public.loans
     set amount_paid = amount_paid + v_capital,
         status = case when amount_paid + v_capital >= total_with_interest - 0.01 then 'paid' else status end
   where id = p_loan_id;

  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from public.loan_installments where loan_id = p_loan_id;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'amount', p_amount,
    'late_fee_paid', v_late_collect,
    'principal_paid', v_capital,
    'remaining_balance', greatest(round(v_total_due - v_capital, 2), 0),
    'installments_paid', v_paid_count,
    'installments_total', v_total_count
  );
end;
$function$;

-- 2. Anular un abono de préstamo: una dación no se anula desde aquí -------------------------

create or replace function public.void_loan_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p         public.loan_payments%rowtype;
  v_loan      public.loans%rowtype;
  v_inst_ent  jsonb;
  v_principal numeric;
  v_user_name text;
  v_session   caja_sessions%rowtype;
  v_cash_out  boolean := false;
  v_new_paid  numeric;
begin
  select * into v_p from public.loan_payments where id = p_payment_id for update;
  if not found or (v_p.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Abono no encontrado.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular un abono.';
  end if;
  if v_p.voided_at is not null then
    raise exception 'Este abono ya fue anulado.';
  end if;
  -- La moto ya entró al inventario del negocio: revertirla es deshacer la liquidación.
  if v_p.method = 'dacion' then
    raise exception 'Este abono es una dación en pago: se revierte desde la ficha de la moto.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;
  if v_p.allocation is null then
    raise exception 'Este abono es anterior al registro de aplicación por cuota, así que no se puede revertir automáticamente. Corrígelo desde la base con respaldo.';
  end if;

  select * into v_loan from public.loans where id = v_p.loan_id for update;
  if not found then
    raise exception 'Préstamo no encontrado.';
  end if;
  if v_loan.status = 'refinanced' then
    raise exception 'Este abono es anterior a una refinanciación: no se puede anular.';
  end if;

  select name into v_user_name from public.profiles where id = auth.uid();

  -- Mismo criterio que en los abonos de venta: si el cobro cae dentro de la
  -- sesión que sigue abierta basta con excluirlo del cierre; si venía de una
  -- sesión ya cerrada, esa contó el dinero y hay que sacarlo ahora.
  -- Cobrado en la calle: sin entregar, el dinero sigue en el bolsillo del cobrador
  -- (no se toca la caja); ya entregado, entró con la entrega y sale siempre.
  if v_p.method = 'cash'
     and is_module_enabled(v_p.company_id, 'caja', false)
     and v_p.branch_id is not null
     and branch_uses_caja(v_p.branch_id)
     and not (v_p.en_calle and v_p.settlement_id is null) then
    select * into v_session from caja_sessions
     where branch_id = v_p.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal antes de anular un abono cobrado en efectivo.';
    end if;
    v_cash_out := v_p.en_calle or (v_session.opened_at > v_p.date);
  end if;

  for v_inst_ent in select * from jsonb_array_elements(v_p.allocation->'installments')
  loop
    update public.loan_installments li
       set paid_amount   = greatest(round(li.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 2), 0),
           late_fee_paid = greatest(round(li.late_fee_paid - coalesce((v_inst_ent->>'late_fee')::numeric, 0), 2), 0),
           status = case
             when greatest(li.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= li.amount - 0.005 then 'paid'
             when greatest(li.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) <= 0.005 then 'pending'
             else 'partial' end,
           paid_at = case
             when greatest(li.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= li.amount - 0.005 then li.paid_at
             else null end
     where li.id = (v_inst_ent->>'id')::uuid;
  end loop;

  v_principal := coalesce((v_p.allocation->>'principal')::numeric, 0);
  v_new_paid  := greatest(round(v_loan.amount_paid - v_principal, 2), 0);

  -- Un préstamo cancelado sigue cancelado: anular un abono no lo revive.
  update public.loans
     set amount_paid = v_new_paid,
         status = case
           when v_new_paid >= total_with_interest - 0.01 then 'paid'
           when status = 'paid' then 'active'
           else status end
   where id = v_loan.id;

  update public.loan_payments
     set voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_user_name, void_reason = btrim(p_reason)
   where id = p_payment_id;

  if v_cash_out then
    insert into caja_movements
      (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
    values
      (v_session.id, v_p.company_id, v_p.branch_id, 'out', v_p.amount,
       'Anulación de abono de préstamo del ' || to_char(v_p.date, 'DD/MM/YYYY') || ': ' || btrim(p_reason),
       auth.uid(), v_user_name);
  end if;

  return jsonb_build_object(
    'payment_id',        v_p.id,
    'amount',            v_p.amount,
    'cash_returned',     v_cash_out,
    'loan_amount_paid',  v_new_paid,
    'remaining_balance', greatest(round(v_loan.total_with_interest - v_new_paid, 2), 0)
  );
end;
$function$;

-- 3. Deuda exigible de un préstamo -----------------------------------------------------------------
-- Lo máximo que acepta register_loan_payment: capital e interés pendientes más la mora,
-- con el mismo cálculo (la política congelada del préstamo y late_fee_due).

create or replace function public.motos_deuda_prestamo(p_loan_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_loan        public.loans%rowtype;
  v_late_rate   numeric;
  v_late_mode   text;
  v_grace       int;
  v_max_rate    numeric;
  v_period_days int;
  v_today       date;
  v_late        numeric;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found or (v_loan.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Préstamo no encontrado.';
  end if;
  select coalesce(v_loan.late_fee_rate, c.loan_late_fee_rate, 5),
         coalesce(nullif(v_loan.late_fee_mode, ''), 'once'),
         coalesce(v_loan.late_fee_grace_days, c.loan_late_fee_grace_days, 0),
         coalesce(v_loan.late_fee_max_rate, 0)
    into v_late_rate, v_late_mode, v_grace, v_max_rate
    from public.companies c where c.id = v_loan.company_id;
  v_period_days := public.late_fee_period_days(v_loan.payment_frequency);
  v_today := public.company_today(v_loan.company_id);
  select coalesce(sum(public.late_fee_due(amount, paid_amount, late_fee_paid, due_date, v_today,
                                          v_late_rate, v_late_mode, v_grace, v_max_rate, v_period_days)), 0)
    into v_late
    from public.loan_installments where loan_id = p_loan_id and status <> 'paid';
  return round(greatest(v_loan.total_with_interest - v_loan.amount_paid, 0) + v_late, 2);
end;
$$;

-- 4. Devolver dinero al cliente (interna) ------------------------------------------------------------
-- En efectivo y con caja en la sucursal: un movimiento de salida en la caja abierta.
-- Por transferencia, o sin caja, solo queda anotado en la recuperación.

create or replace function public.motos_devolver_dinero(p_company uuid, p_branch uuid, p_monto numeric, p_metodo text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.caja_sessions%rowtype;
begin
  if p_monto is null or p_monto <= 0 or p_metodo <> 'cash' then
    return;
  end if;
  if not (public.is_module_enabled(p_company, 'caja', false) and public.branch_uses_caja(p_branch)) then
    return;
  end if;
  select * into v_session from public.caja_sessions where branch_id = p_branch and status = 'open' for update;
  if not found then
    raise exception 'Abre la caja de esta sucursal para devolver el dinero.';
  end if;
  insert into public.caja_movements (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
  values (v_session.id, p_company, p_branch, 'out', p_monto, p_motivo, auth.uid(),
          (select name from public.profiles where id = auth.uid()));
end;
$$;

-- 5. Incautar la moto en garantía ------------------------------------------------------------------

create or replace function public.motos_incautar(p_vehicle_id uuid, p_fecha date, p_motivo text, p_nota text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v    public.vehicles%rowtype;
  l    public.loans%rowtype;
  v_id uuid;
begin
  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found or (v.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Moto no encontrada.';
  end if;
  if not public.is_module_enabled(v.company_id, 'motoprestamos', false) then
    raise exception 'El módulo Motopréstamos está apagado.';
  end if;
  if not (public.is_company_admin() or public.is_super_admin()
          or public.motos_tiene_permiso(v.branch_id, 'motos', 'edit')) then
    raise exception 'No tienes permiso para incautar o devolver motos.';
  end if;
  if v.status <> 'en_garantia' or v.loan_id is null then
    raise exception 'Esta moto no está en garantía de un préstamo activo.';
  end if;
  select * into l from public.loans where id = v.loan_id for update;
  if l.status <> 'active' then
    raise exception 'Esta moto no está en garantía de un préstamo activo.';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo.';
  end if;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'incautacion', true);
  perform set_config('motos.nota', 'Incautada: ' || btrim(p_motivo), true);
  update public.vehicles set status = 'recuperado' where id = v.id;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  perform set_config('motos.nota', '', true);

  insert into public.vehicle_recoveries
    (company_id, branch_id, vehicle_id, kind, loan_id, status, recovered_on, reason, note, debt_at_recovery, created_by_name)
  values
    (v.company_id, v.branch_id, v.id, 'garantia', l.id, 'incautada', coalesce(p_fecha, public.company_today(v.company_id)),
     btrim(p_motivo), nullif(btrim(coalesce(p_nota, '')), ''), public.motos_deuda_prestamo(l.id),
     (select name from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- 6. Devolver la moto incautada -----------------------------------------------------------------------
-- Préstamo activo: vuelve a garantía. Ya pagado o cancelado: liberada, con la matrícula
-- lista para entregar (como motos_prestamo_estado).

create or replace function public.motos_devolver_garantia(p_vehicle_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vehicles%rowtype;
  l public.loans%rowtype;
  r public.vehicle_recoveries%rowtype;
begin
  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found or (v.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Moto no encontrada.';
  end if;
  if not (public.is_company_admin() or public.is_super_admin()
          or public.motos_tiene_permiso(v.branch_id, 'motos', 'edit')) then
    raise exception 'No tienes permiso para incautar o devolver motos.';
  end if;
  select * into r from public.vehicle_recoveries
   where vehicle_id = v.id and kind = 'garantia' and status = 'incautada'
   order by created_at desc limit 1 for update;
  if v.status <> 'recuperado' or not found then
    raise exception 'Esta moto no está incautada.';
  end if;
  select * into l from public.loans where id = v.loan_id;
  if l.status = 'refinanced' then
    raise exception 'El préstamo de esta moto se refinanció mientras estaba incautada: revísalo antes de devolverla.';
  end if;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'devolucion', true);
  perform set_config('motos.nota', coalesce('Devuelta: ' || nullif(btrim(coalesce(p_nota, '')), ''), 'Devuelta al cliente'), true);
  if l.status = 'active' then
    update public.vehicles set status = 'en_garantia' where id = v.id;
  else
    update public.vehicles
       set status = 'liberado',
           registration_status = case when registration_status = 'en_custodia' then 'lista_para_entregar' else registration_status end,
           registration_since = case when registration_status = 'en_custodia' then now() else registration_since end
     where id = v.id;
  end if;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  perform set_config('motos.nota', '', true);

  update public.vehicle_recoveries
     set status = 'devuelta', closed_at = now(),
         note = concat_ws(' · ', note, nullif(btrim(coalesce(p_nota, '')), ''))
   where id = r.id;
end;
$$;

-- 7. Liquidar la garantía: vender a un tercero o quedársela (dación en pago) ------------------------

create or replace function public.motos_liquidar_garantia(
  p_vehicle_id uuid, p_modo text, p_monto numeric, p_metodo text default 'cash', p_product_id uuid default null,
  p_faltante text default 'deuda', p_referencia text default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v          public.vehicles%rowtype;
  l          public.loans%rowtype;
  r          public.vehicle_recoveries%rowtype;
  v_deuda    numeric;
  v_aplicado numeric;
  v_sobrante numeric;
  v_faltante numeric;
  v_res      jsonb;
  v_pago     uuid;
  v_cliente  text;
begin
  if not (public.is_company_admin() or public.is_super_admin()) then
    raise exception 'Solo un administrador puede liquidar una garantía o recuperar una venta.';
  end if;
  if p_modo not in ('tercero', 'dacion') then
    raise exception 'Forma de liquidar no válida.';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto tiene que ser mayor que cero.';
  end if;
  if p_metodo not in ('cash', 'transfer') then
    raise exception 'Método de pago no válido.';
  end if;
  if p_faltante not in ('deuda', 'baja') then
    raise exception 'Indica qué hacer con lo que falte.';
  end if;

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found or (v.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Moto no encontrada.';
  end if;
  select * into r from public.vehicle_recoveries
   where vehicle_id = v.id and kind = 'garantia' and status = 'incautada'
   order by created_at desc limit 1 for update;
  if v.status <> 'recuperado' or not found then
    raise exception 'Esta moto no está incautada.';
  end if;
  select * into l from public.loans where id = v.loan_id for update;
  if l.status <> 'active' then
    raise exception 'Esta moto no está en garantía de un préstamo activo.';
  end if;
  if p_modo = 'dacion' and not exists (
    select 1 from public.products p
     where p.id = p_product_id and p.is_vehicle and p.branch_id = v.branch_id and p.company_id = v.company_id) then
    raise exception 'El artículo tiene que ser un artículo-vehículo de la misma sucursal.';
  end if;

  select name into v_cliente from public.customers where id = l.customer_id;
  v_deuda := public.motos_deuda_prestamo(l.id);
  v_aplicado := least(p_monto, v_deuda);
  v_sobrante := round(p_monto - v_aplicado, 2);
  v_faltante := round(v_deuda - v_aplicado, 2);

  -- Lo obtenido (o la tasación) va al préstamo hasta la deuda.
  if v_aplicado > 0 then
    if p_modo = 'tercero' then
      v_res := public.register_loan_payment(l.id, v_aplicado, p_metodo, v.branch_id,
                 coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Liquidación de la garantía'), p_referencia);
    else
      perform set_config('app.motos_dacion', 'on', true);
      v_res := public.register_loan_payment(l.id, v_aplicado, 'dacion', v.branch_id,
                 coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Dación en pago de la moto'), p_referencia);
      perform set_config('app.motos_dacion', 'off', true);
    end if;
    v_pago := (v_res->>'payment_id')::uuid;
  end if;

  -- El sobrante es del cliente. A un tercero, el dinero pasa del comprador al cliente y
  -- no entra a la gaveta; en la dación lo paga el negocio (en efectivo, de la caja).
  if v_sobrante > 0 and p_modo = 'dacion' then
    perform public.motos_devolver_dinero(v.company_id, v.branch_id, v_sobrante, p_metodo,
                                         'Sobrante de la garantía: ' || coalesce(v_cliente, 'cliente'));
  end if;

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'liquidacion', true);
  if p_modo = 'tercero' then
    perform set_config('motos.nota', 'Vendida a un tercero por RD$' || to_char(p_monto, 'FM999,999,990.00'), true);
    update public.vehicles set status = 'baja' where id = v.id;
  else
    perform set_config('motos.nota', 'Dación en pago: entra al inventario por RD$' || to_char(p_monto, 'FM999,999,990.00'), true);
    update public.vehicles
       set origin = 'inventario', product_id = p_product_id, customer_id = null, loan_id = null,
           status = 'disponible', condition = 'usado', cost = p_monto, registration_status = 'no_aplica'
     where id = v.id;
  end if;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  perform set_config('motos.nota', '', true);

  -- Lo que falta: queda como deuda o se da de baja (el préstamo se cancela).
  if v_faltante > 0 and p_faltante = 'baja' then
    update public.loans set written_off_amount = v_faltante, status = 'cancelled' where id = l.id;
  end if;

  update public.vehicle_recoveries
     set status = 'liquidada', liquidation_mode = p_modo, proceeds = p_monto, applied = v_aplicado,
         reentry_value = case when p_modo = 'dacion' then p_monto end,
         refunded = v_sobrante, refund_method = case when v_sobrante > 0 then p_metodo end,
         shortfall_action = case when v_faltante > 0 then p_faltante end,
         written_off = case when v_faltante > 0 and p_faltante = 'baja' then v_faltante else 0 end,
         payment_id = v_pago, closed_at = now(),
         note = concat_ws(' · ', note, nullif(btrim(coalesce(p_nota, '')), ''))
   where id = r.id;

  return jsonb_build_object('recovery_id', r.id, 'deuda', v_deuda, 'aplicado', v_aplicado,
                            'sobrante', v_sobrante, 'faltante', v_faltante, 'payment_id', v_pago);
end;
$$;

-- 8. Recuperar la moto vendida a cuotas ---------------------------------------------------------------
-- La moto vuelve al inventario como usada y el saldo de la venta se da de baja. Primero
-- se suelta la moto y después se cierra la venta: así motos_venta_saldada no la encuentra
-- y la matrícula no queda «lista para entregar».

create or replace function public.motos_recuperar_venta(
  p_vehicle_id uuid, p_fecha date, p_motivo text, p_estado text, p_valor_reingreso numeric,
  p_devolucion numeric default 0, p_devolucion_metodo text default 'cash', p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.vehicles%rowtype;
  s       public.sales%rowtype;
  v_deuda numeric;
  v_id    uuid;
  v_dev   numeric := coalesce(p_devolucion, 0);
  v_cliente text;
begin
  if not (public.is_company_admin() or public.is_super_admin()) then
    raise exception 'Solo un administrador puede liquidar una garantía o recuperar una venta.';
  end if;
  if p_valor_reingreso is null or p_valor_reingreso < 0 then
    raise exception 'El valor de reingreso no puede ser negativo.';
  end if;
  if v_dev < 0 then
    raise exception 'La devolución no puede ser negativa.';
  end if;
  if p_devolucion_metodo not in ('cash', 'transfer') then
    raise exception 'Método de pago no válido.';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo.';
  end if;

  select * into v from public.vehicles where id = p_vehicle_id for update;
  if not found or (v.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Moto no encontrada.';
  end if;
  if not public.is_module_enabled(v.company_id, 'motoprestamos', false) then
    raise exception 'El módulo Motopréstamos está apagado.';
  end if;
  if v.origin <> 'inventario' or v.status <> 'vendido' or v.sale_id is null then
    raise exception 'Esta moto no está vendida a crédito con saldo pendiente.';
  end if;
  select * into s from public.sales where id = v.sale_id for update;
  if s.cancelled_at is not null or s.payment_status::text not in ('credit', 'in_financing') then
    raise exception 'Esta moto no está vendida a crédito con saldo pendiente.';
  end if;

  -- La misma deuda que recompute_customer_balance.
  v_deuda := greatest(round(
    case when s.payment_status::text = 'in_financing'
         then coalesce((s.financing_details->>'totalWithInterest')::numeric, s.total) - s.amount_paid
         else s.total - s.amount_paid end, 2), 0);
  select name into v_cliente from public.customers where id = s.customer_id;

  -- Lo que el negocio le devuelve al cliente (en efectivo, de la caja abierta).
  perform public.motos_devolver_dinero(v.company_id, v.branch_id, v_dev, p_devolucion_metodo,
                                       'Devolución al cliente por recuperación: ' || coalesce(v_cliente, 'cliente'));

  perform set_config('motos.sistema', 'si', true);
  perform set_config('motos.evento', 'recuperacion', true);
  perform set_config('motos.nota', 'Recuperada: ' || btrim(p_motivo), true);
  update public.vehicles
     set status = 'disponible', condition = 'usado', cost = p_valor_reingreso,
         sale_id = null, customer_id = null, registration_status = 'no_aplica'
   where id = v.id;
  perform set_config('motos.sistema', '', true);
  perform set_config('motos.evento', '', true);
  perform set_config('motos.nota', '', true);

  update public.sales
     set recovered_at = now(), written_off_amount = v_deuda, payment_status = 'paid'::payment_status
   where id = s.id;
  perform public.recompute_customer_balance(s.customer_id);

  insert into public.vehicle_recoveries
    (company_id, branch_id, vehicle_id, kind, sale_id, status, recovered_on, reason, condition_note,
     debt_at_recovery, reentry_value, written_off, refunded, refund_method, note, created_by_name, closed_at)
  values
    (v.company_id, v.branch_id, v.id, 'venta', s.id, 'recuperada', coalesce(p_fecha, public.company_today(v.company_id)),
     btrim(p_motivo), nullif(btrim(coalesce(p_estado, '')), ''), v_deuda, p_valor_reingreso, v_deuda,
     v_dev, case when v_dev > 0 then p_devolucion_metodo end, nullif(btrim(coalesce(p_nota, '')), ''),
     (select name from public.profiles where id = auth.uid()), now())
  returning id into v_id;

  return jsonb_build_object('recovery_id', v_id, 'deuda', v_deuda, 'devuelto', v_dev);
end;
$$;

-- 9. Grants ------------------------------------------------------------------------------------------

revoke execute on function public.motos_deuda_prestamo(uuid) from public, anon;
revoke execute on function public.motos_devolver_dinero(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.motos_incautar(uuid, date, text, text) from public, anon;
revoke execute on function public.motos_devolver_garantia(uuid, text) from public, anon;
revoke execute on function public.motos_liquidar_garantia(uuid, text, numeric, text, uuid, text, text, text) from public, anon;
revoke execute on function public.motos_recuperar_venta(uuid, date, text, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.motos_deuda_prestamo(uuid) to authenticated, service_role;
grant execute on function public.motos_devolver_dinero(uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.motos_incautar(uuid, date, text, text) to authenticated, service_role;
grant execute on function public.motos_devolver_garantia(uuid, text) to authenticated, service_role;
grant execute on function public.motos_liquidar_garantia(uuid, text, numeric, text, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.motos_recuperar_venta(uuid, date, text, text, numeric, numeric, text, text) to authenticated, service_role;
