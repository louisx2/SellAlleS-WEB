-- Cerrar bien lo que la migración anterior dejó a medias.
--
-- En crédito y financiamiento se construyó `void_credit_payment` ANTES de
-- revocar los permisos de escritura, para que nunca faltara una forma legítima
-- de corregir un abono mal digitado. En préstamos se revocó igual y no se
-- construyó la puerta: hoy `loan_payments` no tiene ni UPDATE/DELETE directo ni
-- anulación, así que un cobro equivocado sería incorregible desde la app. No
-- ha pasado nada porque todavía no hay ni un abono de préstamo cobrado, pero
-- eso es suerte, no diseño. Aquí entra `void_loan_payment`.
--
-- Y ya que estamos, se cierran las tablas que quedaban con el mismo agujero,
-- cada una con su salida de emergencia comprobada:
--
--   caja_movements  → un movimiento es un asiento: lo que corrige un movimiento
--                     equivocado es otro en sentido contrario, y para eso ya
--                     existe `register_caja_movement`. Nada queda varado.
--   caja_sessions   → solo las escriben open_caja_session y close_caja_session.
--   credit_notes    → solo las escribe annul_sale. (RLS ya lo bloqueaba: no hay
--                     policy de escritura. El grant sobraba.)
--   supplier_payments → aquí SÍ hacía falta la puerta primero: entra
--                     `void_supplier_payment`, que devuelve el dinero a la
--                     factura y a la caja.
--
-- `supplier_invoices` y `expenses` se quedan como están a propósito: borrar una
-- factura sin abonos y editar o borrar un gasto son operaciones normales de la
-- app, no manipulación del libro. La policy de borrado de supplier_invoices ya
-- exige `amount_paid = 0`.


-- ── Préstamos: trazabilidad y anulación ─────────────────────────────────────

alter table public.loan_payments
  add column if not exists allocation jsonb,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists voided_by_name text,
  add column if not exists void_reason text;

comment on column public.loan_payments.allocation is
  'A qué cuota fue cada peso. Lo escribe register_loan_payment y lo lee void_loan_payment.';
comment on column public.loan_payments.voided_at is
  'Los abonos no se borran: se anulan por reverso. Todo lo que sume dinero debe filtrar voided_at is null.';


-- ── RPC de préstamos: ahora guarda a qué cuota fue cada peso ────────────────

create or replace function public.register_loan_payment(
  p_loan_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_loan          public.loans%rowtype;
  v_late_rate     numeric;
  v_grace         int;
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
  if p_method not in ('cash','card','transfer') then
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

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_loan.company_id;
    if not found then
      raise exception 'Sucursal no válida para este préstamo.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_loan.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  select coalesce(loan_late_fee_rate, 5), coalesce(late_fee_grace_days, 0)
    into v_late_rate, v_grace
    from public.companies where id = v_loan.company_id;
  v_late_rate := coalesce(v_late_rate, 5);
  v_grace     := coalesce(v_grace, 0);
  v_today     := company_today(v_loan.company_id);

  v_total_due := v_loan.total_with_interest - v_loan.amount_paid;

  perform 1 from public.loan_installments where loan_id = p_loan_id for update;

  select coalesce(sum(greatest(round(amount * v_late_rate / 100, 2) - late_fee_paid, 0)), 0)
    into v_late_due
    from public.loan_installments
   where loan_id = p_loan_id and status <> 'paid' and due_date + v_grace < v_today;

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
    v_fee_due := greatest(round(v_inst.amount * v_late_rate / 100, 2) - v_inst.late_fee_paid, 0);
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

revoke all on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;


-- ── RPC: anular un abono de préstamo ────────────────────────────────────────

create or replace function public.void_loan_payment(
  p_payment_id uuid,
  p_reason text
) returns jsonb
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

  select name into v_user_name from public.profiles where id = auth.uid();

  -- Mismo criterio que en los abonos de venta: si el cobro cae dentro de la
  -- sesión que sigue abierta basta con excluirlo del cierre; si venía de una
  -- sesión ya cerrada, esa contó el dinero y hay que sacarlo ahora.
  if v_p.method = 'cash'
     and is_module_enabled(v_p.company_id, 'caja', false)
     and v_p.branch_id is not null
     and branch_uses_caja(v_p.branch_id) then
    select * into v_session from caja_sessions
     where branch_id = v_p.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal antes de anular un abono cobrado en efectivo.';
    end if;
    v_cash_out := (v_session.opened_at > v_p.date);
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

  update public.loans
     set amount_paid = v_new_paid,
         status = case when v_new_paid >= total_with_interest - 0.01 then 'paid' else 'active' end
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

comment on function public.void_loan_payment(uuid, text) is
  'Anula un abono de préstamo por reverso (no lo borra): devuelve capital y mora a las cuotas que los recibieron y saca el efectivo de la caja si venía de una sesión ya cerrada. Solo administradores.';

revoke all on function public.void_loan_payment(uuid, text) from public, anon;
grant execute on function public.void_loan_payment(uuid, text) to authenticated, service_role;


-- ── Suplidores: la puerta antes de cerrar la ventana ────────────────────────

alter table public.supplier_payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists voided_by_name text,
  add column if not exists void_reason text;

comment on column public.supplier_payments.voided_at is
  'Los pagos no se borran: se anulan por reverso. Todo lo que sume dinero debe filtrar voided_at is null.';


-- SECURITY DEFINER porque `supplier_payments` y `caja_movements` dejan de ser
-- escribibles desde el navegador. Cuerpo igual al que estaba en producción,
-- más la validación de acceso y de que la sucursal sea de la empresa.

create or replace function public.register_supplier_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice       supplier_invoices%rowtype;
  v_company       uuid;
  v_user_name     text;
  v_supplier_name text;
  v_payment_id    uuid;
  v_session       caja_sessions%rowtype;
  v_new_paid      numeric;
  v_new_balance   numeric;
  v_new_status    text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_invoice from supplier_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Factura no encontrada.';
  end if;

  -- Mismo criterio que la policy `supplier_invoices_update`.
  if not (is_super_admin() or (v_invoice.company_id = current_company_id()
          and (is_company_admin()
               or v_invoice.branch_id in (select user_branch_ids())
               or v_invoice.branch_id is null))) then
    raise exception 'No tienes acceso a esta factura.';
  end if;

  if v_invoice.status = 'paid' then
    raise exception 'Esta factura ya está saldada.';
  end if;

  v_company := v_invoice.company_id;

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_company;
    if not found then
      raise exception 'Sucursal no válida para esta factura.';
    end if;
  end if;

  if p_amount > v_invoice.balance + 0.01 then
    raise exception 'El abono (RD$%) excede el balance pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_invoice.balance, 'FM999,999,990.00');
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_company, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de pagar en efectivo.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();
  select name into v_supplier_name from suppliers where id = v_invoice.supplier_id;

  insert into supplier_payments
    (company_id, invoice_id, supplier_id, branch_id, amount, method, reference, notes, user_id, user_name, date)
  values
    (v_company, v_invoice.id, v_invoice.supplier_id, p_branch_id, p_amount,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
  returning id into v_payment_id;

  v_new_paid    := v_invoice.amount_paid + p_amount;
  v_new_balance := v_invoice.total - v_invoice.itbis_retenido - v_invoice.isr_retention_amount - v_new_paid;
  v_new_status  := case when v_new_balance <= 0.01 then 'paid' else 'partial' end;

  update supplier_invoices
     set amount_paid  = v_new_paid,
         payment_date = current_date,
         status       = v_new_status
   where id = v_invoice.id;

  -- El cierre de caja cuadra por movimientos: un pago en efectivo a un
  -- suplidor sale del efectivo de la sucursal.
  if p_method = 'cash' and is_module_enabled(v_company, 'caja', false) then
    select * into v_session from caja_sessions
     where branch_id = p_branch_id and status = 'open' for update;
    if found then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_company, p_branch_id, 'out', p_amount,
         'Pago a suplidor: ' || coalesce(v_supplier_name, ''), auth.uid(), v_user_name);
    end if;
  end if;

  return jsonb_build_object(
    'payment_id',        v_payment_id,
    'amount',            p_amount,
    'remaining_balance', greatest(v_new_balance, 0),
    'status',            v_new_status
  );
end;
$function$;

revoke all on function public.register_supplier_payment(uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.register_supplier_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;


-- ── RPC: anular un pago a suplidor ──────────────────────────────────────────

create or replace function public.void_supplier_payment(
  p_payment_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p           supplier_payments%rowtype;
  v_invoice     supplier_invoices%rowtype;
  v_user_name   text;
  v_supplier    text;
  v_session     caja_sessions%rowtype;
  v_new_paid    numeric;
  v_new_balance numeric;
  v_new_status  text;
  v_cash_in     boolean := false;
begin
  select * into v_p from supplier_payments where id = p_payment_id for update;
  if not found or (v_p.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Pago no encontrado.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular un pago a suplidor.';
  end if;
  if v_p.voided_at is not null then
    raise exception 'Este pago ya fue anulado.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;

  select * into v_invoice from supplier_invoices where id = v_p.invoice_id for update;
  if not found then
    raise exception 'Factura no encontrada.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();
  select name into v_supplier from suppliers where id = v_p.supplier_id;

  -- Aquí el dinero SALIÓ, así que al anular vuelve. El 'out' original quedó
  -- como movimiento de caja con su propia fila, que no se toca: se compensa
  -- siempre con un 'in', esté en la sesión que esté.
  if v_p.method = 'cash'
     and is_module_enabled(v_p.company_id, 'caja', false)
     and v_p.branch_id is not null
     and branch_uses_caja(v_p.branch_id) then
    select * into v_session from caja_sessions
     where branch_id = v_p.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal antes de anular un pago hecho en efectivo.';
    end if;
    v_cash_in := true;
  end if;

  v_new_paid    := greatest(round(v_invoice.amount_paid - v_p.amount, 2), 0);
  v_new_balance := round(v_invoice.total - v_invoice.itbis_retenido - v_invoice.isr_retention_amount - v_new_paid, 2);
  v_new_status  := case
                     when v_new_balance <= 0.01 then 'paid'
                     when v_new_paid > 0        then 'partial'
                     else 'pending'
                   end;

  update supplier_invoices
     set amount_paid  = v_new_paid,
         status       = v_new_status,
         payment_date = case when v_new_paid = 0 then null else payment_date end
   where id = v_invoice.id;

  update supplier_payments
     set voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_user_name, void_reason = btrim(p_reason)
   where id = p_payment_id;

  if v_cash_in then
    insert into caja_movements
      (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
    values
      (v_session.id, v_p.company_id, v_p.branch_id, 'in', v_p.amount,
       'Anulación de pago a suplidor' || coalesce(' ' || v_supplier, '')
         || ' del ' || to_char(v_p.date, 'DD/MM/YYYY') || ': ' || btrim(p_reason),
       auth.uid(), v_user_name);
  end if;

  return jsonb_build_object(
    'payment_id',        v_p.id,
    'amount',            v_p.amount,
    'cash_returned',     v_cash_in,
    'remaining_balance', greatest(v_new_balance, 0),
    'status',            v_new_status
  );
end;
$function$;

comment on function public.void_supplier_payment(uuid, text) is
  'Anula un pago a suplidor por reverso (no lo borra): devuelve el monto al balance de la factura y el efectivo a la caja. Solo administradores.';

revoke all on function public.void_supplier_payment(uuid, text) from public, anon;
grant execute on function public.void_supplier_payment(uuid, text) to authenticated, service_role;


-- ── El cierre de caja tampoco cuenta abonos de préstamo anulados ────────────

create or replace function public.close_caja_session(
  p_session_id uuid,
  p_closing_amount_declared numeric,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company     uuid;
  v_user_name   text;
  v_s           caja_sessions%rowtype;
  v_cash_sales  numeric;
  v_credit_cash numeric;
  v_loan_cash   numeric;
  v_mov_in      numeric;
  v_mov_out     numeric;
  v_expected    numeric;
  v_diff        numeric;
  v_breakdown   jsonb;
begin
  if p_closing_amount_declared is null or p_closing_amount_declared < 0 then
    raise exception 'El monto declarado no puede ser negativo.';
  end if;

  v_company := current_company_id();

  select * into v_s from caja_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesión de caja no encontrada.';
  end if;
  if v_s.company_id <> v_company and not is_super_admin() then
    raise exception 'No tienes acceso a esta caja.';
  end if;
  if not (is_company_admin() or v_s.branch_id in (select user_branch_ids()) or is_super_admin()) then
    raise exception 'No tienes acceso a la caja de esta sucursal.';
  end if;
  if v_s.status <> 'open' then
    raise exception 'Esta caja ya fue cerrada.';
  end if;

  v_cash_sales := coalesce((select sum(total) from sales
                where branch_id = v_s.branch_id and payment_method = 'cash'
                  and created_at >= v_s.opened_at and created_at < now()), 0);
  -- Un abono anulado nunca se quedó en la gaveta: no puede cuadrar el cierre.
  v_credit_cash := coalesce((select sum(amount) from credit_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and voided_at is null
                  and date >= v_s.opened_at and date < now()), 0);
  v_loan_cash := coalesce((select sum(amount) from loan_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and voided_at is null
                  and date >= v_s.opened_at and date < now()), 0);
  v_mov_in := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'in'), 0);
  v_mov_out := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'out'), 0);

  v_expected := v_s.opening_amount + v_cash_sales + v_credit_cash + v_loan_cash + v_mov_in - v_mov_out;
  v_diff := p_closing_amount_declared - v_expected;

  v_breakdown := jsonb_build_object(
    'opening',            v_s.opening_amount,
    'cashSales',          v_cash_sales,
    'creditCashPayments', v_credit_cash,
    'loanCashPayments',   v_loan_cash,
    'movementsIn',        v_mov_in,
    'movementsOut',       v_mov_out,
    'expected',           v_expected,
    'declared',           p_closing_amount_declared,
    'difference',         v_diff
  );

  select name into v_user_name from profiles where id = auth.uid();

  update caja_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         closed_by_name = v_user_name,
         closing_amount_declared = p_closing_amount_declared,
         closing_amount_expected = v_expected,
         difference = v_diff,
         breakdown = v_breakdown,
         notes = coalesce(p_notes, notes)
   where id = p_session_id;

  return jsonb_build_object(
    'session_id',        v_s.id,
    'opening_amount',    v_s.opening_amount,
    'expected',          v_expected,
    'declared',          p_closing_amount_declared,
    'difference',        v_diff
  );
end;
$function$;


-- ── Se cierran las tablas que quedaban ──────────────────────────────────────
--
-- Cada una con su salida de emergencia ya construida y probada. `expenses` y
-- `supplier_invoices` se quedan abiertas a propósito: ahí borrar y editar son
-- operaciones de la app, no manipulación del libro.

revoke insert, update, delete, truncate on public.caja_movements    from anon, authenticated;
revoke insert, update, delete, truncate on public.caja_sessions     from anon, authenticated;
revoke insert, update, delete, truncate on public.credit_notes      from anon, authenticated;
revoke insert, update, delete, truncate on public.supplier_payments from anon, authenticated;
