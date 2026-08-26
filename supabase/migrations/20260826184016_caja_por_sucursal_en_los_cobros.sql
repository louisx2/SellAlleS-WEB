-- Caja por sucursal: terminar el cambio en los cobros.
--
-- `caja_por_sucursal` separó dos cosas que antes eran una: company_modules.caja
-- dice si la EMPRESA ve el módulo, y branches.caja_enabled si ESA sucursal lo
-- exige. El trigger de ventas se actualizó, pero las RPC de cobro se quedaron
-- preguntando solo por la empresa, así que en Pujols Group — caja encendida
-- para DelmasTechnology Principal — las otras dos sucursales (DelmasTechnology
-- R.A y Todo Para Iphone) no podían recibir efectivo: pedían abrir una caja
-- que no usan y que ni siquiera les aparece en el menú.
--
-- Afectaba a los abonos de crédito y financiamiento, los abonos de cliente, los
-- abonos de préstamo, los pagos a suplidores y las anulaciones con devolución
-- en efectivo.
--
-- El gate pasa a ser una sola función, `caja_blocks_cash`, con el mismo
-- criterio que ya usa el trigger de ventas: bloquea si la empresa usa caja Y la
-- sucursal la exige Y no hay ninguna abierta. Sin sucursal se sigue bloqueando,
-- porque no hay caja que comprobar. Los cuerpos de las cinco funciones son los
-- que ya estaban en producción, verbatim; lo único que cambia es esa condición.

-- ── El gate, en un solo lugar ───────────────────────────────────────────────

create or replace function public.caja_blocks_cash(
  p_company_id uuid,
  p_branch_id uuid
) returns boolean
language sql
set search_path to 'public'
as $function$
  select is_module_enabled(p_company_id, 'caja', false)
     and (p_branch_id is null
          or (public.branch_uses_caja(p_branch_id)
              and not public.has_open_caja(p_branch_id)));
$function$;

comment on function public.caja_blocks_cash(uuid, uuid) is
  'true = hay que rechazar este movimiento en efectivo por falta de caja abierta. La empresa enciende el módulo (company_modules.caja) y la sucursal decide si lo exige (branches.caja_enabled).';

revoke all on function public.caja_blocks_cash(uuid, uuid) from public;
grant execute on function public.caja_blocks_cash(uuid, uuid) to authenticated, service_role;


-- ── RPC: abono a una venta a crédito o financiada ───────────────────────────

create or replace function public.register_sale_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale             sales%rowtype;
  v_late_rate        numeric;
  v_total_due        numeric;
  v_late_due         numeric := 0;
  v_late_collect     numeric := 0;
  v_capital          numeric;
  v_remaining        numeric;
  v_inst             record;
  v_apply            numeric;
  v_fee_due          numeric;
  v_payment_id       uuid;
  v_user_name        text;
  v_paid_count       int := 0;
  v_total_count      int := 0;
  v_customer_balance numeric;
  v_is_financing     boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada.';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'Esta venta ya está saldada.';
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_sale.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  v_is_financing := (v_sale.payment_status = 'in_financing');

  select late_fee_rate into v_late_rate from companies where id = v_sale.company_id;
  v_late_rate := coalesce(v_late_rate, 5);

  if v_is_financing then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;

    perform 1 from financing_installments where sale_id = p_sale_id for update;

    select coalesce(sum(greatest(round(amount * v_late_rate / 100, 2) - late_fee_paid, 0)), 0)
      into v_late_due
      from financing_installments
     where sale_id = p_sale_id and status <> 'paid' and due_date < current_date;

    if p_amount > v_total_due + v_late_due + 0.01 then
      raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
        to_char(p_amount, 'FM999,999,990.00'),
        to_char(v_total_due + v_late_due, 'FM999,999,990.00');
    end if;

    v_remaining := p_amount;

    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id and status <> 'paid' and due_date < current_date
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_fee_due := greatest(round(v_inst.amount * v_late_rate / 100, 2) - v_inst.late_fee_paid, 0);
      if v_fee_due > 0 then
        v_apply := least(v_remaining, v_fee_due);
        update financing_installments
           set late_fee_paid = late_fee_paid + v_apply
         where id = v_inst.id;
        v_late_collect := v_late_collect + v_apply;
        v_remaining    := v_remaining - v_apply;
      end if;
    end loop;

    v_capital := v_remaining;

    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id and status <> 'paid'
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_remaining, v_inst.amount - v_inst.paid_amount);
      if v_apply > 0 then
        update financing_installments
           set paid_amount = paid_amount + v_apply,
               status  = case when paid_amount + v_apply >= amount then 'paid' else 'partial' end,
               paid_at = case when paid_amount + v_apply >= amount then now() else paid_at end
         where id = v_inst.id;
        v_remaining := v_remaining - v_apply;
      end if;
    end loop;
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
    if p_amount > v_total_due + 0.01 then
      raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
        to_char(p_amount, 'FM999,999,990.00'),
        to_char(v_total_due, 'FM999,999,990.00');
    end if;
    v_capital := p_amount;
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, late_fee_paid, method, reference, notes, user_id, user_name, date)
  values
    (v_sale.company_id, v_sale.id, v_sale.customer_id, p_branch_id, p_amount, v_late_collect,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
  returning id into v_payment_id;

  update sales
     set amount_paid = amount_paid + v_capital,
         payment_status = case
           when v_is_financing
                and amount_paid + v_capital >=
                    coalesce((financing_details->>'totalWithInterest')::numeric, total) - 0.01
             then 'paid'::payment_status
           when not v_is_financing and amount_paid + v_capital >= total - 0.01
             then 'paid'::payment_status
           else payment_status
         end
   where id = p_sale_id;

  if v_sale.customer_id is not null then
    update customers
       set credit_balance = greatest(credit_balance - v_capital, 0)
     where id = v_sale.customer_id
     returning credit_balance into v_customer_balance;
  end if;

  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from financing_installments
   where sale_id = p_sale_id;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      v_late_collect,
    'principal_paid',     v_capital,
    'remaining_balance',  greatest(v_total_due - v_capital, 0),
    'installments_paid',  v_paid_count,
    'installments_total', v_total_count,
    'customer_balance',   v_customer_balance
  );
end;
$function$;


-- ── RPC: abono general del cliente (se reparte entre sus ventas) ────────────

create or replace function public.register_customer_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_customer   customers%rowtype;
  v_remaining  numeric;
  v_sale       record;
  v_apply      numeric;
  v_payment_id uuid;
  v_user_name  text;
  v_balance    numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del abono debe ser mayor que cero.';
  end if;
  if p_method not in ('cash','card','transfer') then
    raise exception 'Método de pago no válido.';
  end if;

  select * into v_customer from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_customer.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  if p_amount > v_customer.credit_balance + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda del cliente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_customer.credit_balance, 'FM999,999,990.00');
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, method, reference, notes, user_id, user_name, date)
  values
    (v_customer.company_id, null, p_customer_id, p_branch_id, p_amount,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
  returning id into v_payment_id;

  v_remaining := p_amount;
  for v_sale in
    select * from sales
     where customer_id = p_customer_id and payment_status = 'credit'
     order by created_at
     for update
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, v_sale.total - v_sale.amount_paid);
    if v_apply > 0 then
      update sales
         set amount_paid = amount_paid + v_apply,
             payment_status = case
               when amount_paid + v_apply >= total - 0.01 then 'paid'::payment_status
               else payment_status
             end
       where id = v_sale.id;
      v_remaining := v_remaining - v_apply;
    end if;
  end loop;

  update customers
     set credit_balance = greatest(credit_balance - p_amount, 0)
   where id = p_customer_id
   returning credit_balance into v_balance;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      0,
    'principal_paid',     p_amount,
    'remaining_balance',  v_balance,
    'installments_paid',  null,
    'installments_total', null,
    'customer_balance',   v_balance
  );
end;
$function$;


-- ── RPC: abono a un préstamo ────────────────────────────────────────────────

create or replace function public.register_loan_payment(
  p_loan_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_loan          public.loans%rowtype;
  v_late_rate     numeric;
  v_total_due     numeric;
  v_late_due      numeric := 0;
  v_late_collect  numeric := 0;
  v_capital       numeric;
  v_remaining     numeric;
  v_inst          record;
  v_apply         numeric;
  v_fee_due       numeric;
  v_payment_id    uuid;
  v_user_name     text;
  v_paid_count    int := 0;
  v_total_count   int := 0;
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
  if v_loan.status = 'paid' then
    raise exception 'Este préstamo ya está saldado.';
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_loan.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  select loan_late_fee_rate into v_late_rate from public.companies where id = v_loan.company_id;
  v_late_rate := coalesce(v_late_rate, 5);

  v_total_due := v_loan.total_with_interest - v_loan.amount_paid;

  perform 1 from public.loan_installments where loan_id = p_loan_id for update;

  select coalesce(sum(greatest(round(amount * v_late_rate / 100, 2) - late_fee_paid, 0)), 0)
    into v_late_due
    from public.loan_installments
   where loan_id = p_loan_id and status <> 'paid' and due_date < current_date;

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'), to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_remaining := p_amount;

  for v_inst in
    select * from public.loan_installments
     where loan_id = p_loan_id and status <> 'paid' and due_date < current_date
     order by installment_number
  loop
    exit when v_remaining <= 0;
    v_fee_due := greatest(round(v_inst.amount * v_late_rate / 100, 2) - v_inst.late_fee_paid, 0);
    if v_fee_due > 0 then
      v_apply := least(v_remaining, v_fee_due);
      update public.loan_installments set late_fee_paid = late_fee_paid + v_apply where id = v_inst.id;
      v_late_collect := v_late_collect + v_apply;
      v_remaining := v_remaining - v_apply;
    end if;
  end loop;

  v_capital := v_remaining;

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
             status  = case when paid_amount + v_apply >= amount then 'paid' else 'partial' end,
             paid_at = case when paid_amount + v_apply >= amount then now() else paid_at end
       where id = v_inst.id;
      v_remaining := v_remaining - v_apply;
    end if;
  end loop;

  select name into v_user_name from public.profiles where id = auth.uid();

  insert into public.loan_payments
    (company_id, loan_id, customer_id, branch_id, amount, late_fee_paid, method, reference, notes, user_id, user_name, date)
  values
    (v_loan.company_id, v_loan.id, v_loan.customer_id, p_branch_id, p_amount, v_late_collect,
     p_method, p_reference, p_notes, auth.uid(), v_user_name, now())
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
    'remaining_balance', greatest(v_total_due - v_capital, 0),
    'installments_paid', v_paid_count,
    'installments_total', v_total_count
  );
end;
$function$;


-- ── RPC: pago a una factura de suplidor ─────────────────────────────────────

create or replace function public.register_supplier_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_branch_id uuid default null,
  p_notes text default null,
  p_reference text default null
) returns jsonb
language plpgsql
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
  if v_invoice.status = 'paid' then
    raise exception 'Esta factura ya está saldada.';
  end if;

  v_company := v_invoice.company_id;

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


-- ── RPC: anular una venta (la devolución en efectivo sale de la caja) ───────

create or replace function public.annul_sale(
  p_sale_id uuid,
  p_reason text default null,
  p_refund_method text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale          sales%rowtype;
  v_seq           ncf_sequences%rowtype;
  v_session       caja_sessions%rowtype;
  v_item          record;
  v_ncf           text := null;
  v_user_name     text;
  v_note_id       uuid;
  v_refund_method text;
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
  if v_sale.payment_status in ('credit', 'in_financing') then
    raise exception 'Las ventas a crédito o financiadas no se pueden anular: gestiona sus abonos desde Cuentas por Cobrar.';
  end if;

  -- payment_method es un enum en la base: se compara/almacena como texto aquí.
  -- Sin método explícito se asume que el dinero vuelve por donde entró; 'none'
  -- hay que pedirlo a propósito, para que no se anule sin devolver por descuido.
  v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
  if v_refund_method not in ('cash', 'card', 'transfer', 'none') then
    raise exception 'Método de devolución no válido.';
  end if;

  -- NCF B04: solo si la venta original llevó comprobante. Una venta facturada
  -- por error igual consumió su NCF, así que la nota de crédito se emite
  -- aunque no haya devolución: es lo que la deja anulada ante la DGII.
  if v_sale.ncf is not null then
    select * into v_seq from ncf_sequences
     where company_id = v_sale.company_id
       and tipo = 'nota_credito'
       and active
       and (expires_at is null or expires_at >= current_date)
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

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash' and caja_blocks_cash(v_sale.company_id, v_sale.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los productos que no
  -- manejan existencias quedan fuera: nunca se les descontó nada al vender.
  for v_item in
    select si.product_id, si.quantity
      from sale_items si
      join products p on p.id = si.product_id and p.company_id = v_sale.company_id
     where si.sale_id = v_sale.id
       and si.product_id is not null
       and p.tracks_stock
  loop
    update products set stock = stock + v_item.quantity
     where id = v_item.product_id and company_id = v_sale.company_id;
  end loop;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_notes
    (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
     subtotal, itbis_amount, total, refund_method, reason, user_id, user_name)
  values
    (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id,
     v_ncf, v_sale.ncf, v_sale.subtotal, v_sale.itbis_amount, v_sale.total,
     v_refund_method, nullif(p_reason, ''), auth.uid(), v_user_name)
  returning id into v_note_id;

  update sales set cancelled_at = now() where id = v_sale.id;

  if v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
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
    'refund_method',  v_refund_method
  );
end;
$function$;
