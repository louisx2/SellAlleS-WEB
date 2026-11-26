-- Motopréstamos 4A: arreglos de la revisión final de la recuperación.
-- Plan: docs/superpowers/plans/2026-11-24-motoprestamos-entrega-4a-recuperacion.md (Task 7)
--
-- Cada función se copia de su versión viva (md5 del cuerpo verificado contra el
-- archivo de origen) con un solo cambio:
--   pending_due_reminders        a389c20d (20261124120000)  sin avisos del préstamo dado de baja ni de la venta recuperada
--   motos_prestamo_refinanciado  5d8b4bd6 (20261124190000)  la moto incautada y su recuperación pasan al préstamo nuevo
--   register_loan_payment        2fe02973 (20261126130000)  un préstamo dado de baja no recibe abonos
--   void_loan_payment            12ceafba (20261126130000)  el abono de una liquidación no se anula
--   motos_recuperar_venta        d2f06f07 (20261126130000)  una venta con dos motos no se recupera desde una sola
--   motos_venta_recuperada_no_se_anula (20261126120000)     tampoco se reabre (anular un abono viejo la devolvía a crédito)
-- Pruebas: supabase/tests/motos_recuperacion.sql §3

-- 1. La venta recuperada no se anula ni se reabre ------------------------------------------------
-- void_credit_payment recalcula el estado con lo pagado contra el total: en una venta
-- recuperada eso la devolvía a crédito. Cerrarlo aquí cierra todos los caminos.

create or replace function public.motos_venta_recuperada_no_se_anula()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.recovered_at is not null
     and ((old.cancelled_at is null and new.cancelled_at is not null)
          or new.payment_status is distinct from old.payment_status) then
    raise exception 'Esta venta se recuperó: no se puede anular ni reabrir.';
  end if;
  return new;
end;
$$;

drop trigger trg_venta_recuperada_no_se_anula on public.sales;
create trigger trg_venta_recuperada_no_se_anula before update of cancelled_at, payment_status on public.sales
  for each row execute function public.motos_venta_recuperada_no_se_anula();

-- 2. Avisos de cuota por correo -------------------------------------------------------------------

create or replace function public.pending_due_reminders(p_days_ahead integer default 3)
 returns table(kind text, installment_id uuid, company_name text, customer_name text, customer_email text, due_date date, amount_due numeric, late_fee numeric, is_overdue boolean)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select 'loan'::text,
         li.id,
         c.name,
         cu.name,
         cu.email,
         li.due_date,
         round(li.amount - li.paid_amount, 2),
         public.late_fee_due(li.amount, li.paid_amount, li.late_fee_paid, li.due_date,
                             public.company_today(l.company_id),
                             coalesce(l.late_fee_rate, c.loan_late_fee_rate, 5),
                             coalesce(nullif(l.late_fee_mode, ''), 'once'),
                             coalesce(l.late_fee_grace_days, c.loan_late_fee_grace_days, 0),
                             coalesce(l.late_fee_max_rate, 0),
                             public.late_fee_period_days(l.payment_frequency)),
         li.due_date < public.company_today(l.company_id)
    from loan_installments li
    join loans l     on l.id = li.loan_id
    join companies c on c.id = l.company_id
    join customers cu on cu.id = l.customer_id
   where li.reminder_sent_at is null
     and li.status <> 'paid'
     and l.status <> 'cancelled'
     and c.status::text <> 'suspended'
     and l.payment_frequency not in ('daily', 'daily_all')
     and li.due_date <= public.company_today(l.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> ''

  union all

  select 'sale'::text,
         fi.id,
         c.name,
         cu.name,
         cu.email,
         fi.due_date,
         round(fi.amount - fi.paid_amount, 2),
         public.late_fee_due(fi.amount, fi.paid_amount, fi.late_fee_paid, fi.due_date,
                             public.company_today(s.company_id),
                             p.rate, p.fee_mode, p.grace_days, p.max_rate, p.period_days),
         fi.due_date < public.company_today(s.company_id)
    from financing_installments fi
    join sales s     on s.id = fi.sale_id
    join companies c on c.id = s.company_id
    join customers cu on cu.id = s.customer_id
    cross join lateral public.late_fee_policy(s.financing_details, c.late_fee_rate, c.late_fee_grace_days) p
   where fi.reminder_sent_at is null
     and fi.status <> 'paid'
     and s.cancelled_at is null
     and s.recovered_at is null
     and c.status::text <> 'suspended'
     and coalesce(s.financing_details->>'frequency', 'monthly') not in ('daily', 'daily_all')
     and fi.due_date <= public.company_today(s.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> '';
$function$;

-- 3. Refinanciación con la moto incautada --------------------------------------------------------

create or replace function public.motos_prestamo_refinanciado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text := (select name from public.profiles where id = auth.uid());
begin
  perform set_config('motos.sistema', 'si', true);
  with movidas as (
    update public.vehicles set loan_id = new.id
     where loan_id = new.refinanced_from_id and status in ('en_garantia', 'recuperado')
    returning id, company_id, status
  )
  insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, note, loan_id, created_by_name)
  select m.company_id, m.id, 'garantia', m.status, m.status, 'Refinanciación', new.id, v_usuario from movidas m;
  perform set_config('motos.sistema', '', true);
  update public.vehicle_recoveries set loan_id = new.id
   where loan_id = new.refinanced_from_id and status = 'incautada';
  return null;
end;
$$;

-- 4. Abonos: un préstamo dado de baja no los recibe ---------------------------------------------

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
  if v_loan.status = 'cancelled' then
    raise exception 'Este préstamo se cerró con el saldo dado de baja: no recibe abonos.';
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

-- 5. Anular un abono de préstamo: tampoco el de una liquidación ----------------------------------

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
  -- El abono de la venta a un tercero: la moto ya salió y la recuperación está cerrada.
  if exists (select 1 from public.vehicle_recoveries where payment_id = v_p.id) then
    raise exception 'Este abono es la liquidación de la garantía de una moto: no se anula.';
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

-- 6. Recuperar la moto vendida: solo si es la única de la venta -----------------------------------

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
  -- El saldo es de la venta entera: con otra moto en la misma venta, darlo de baja
  -- se la regalaría al cliente (y motos_venta_saldada le soltaría la matrícula).
  if (select count(*) from public.vehicles where sale_id = s.id) > 1 then
    raise exception 'Esta venta tiene más de una moto: no se puede recuperar una sola.';
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
