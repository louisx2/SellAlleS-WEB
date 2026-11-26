-- Motopréstamos 3A: cobro en la calle, visitas, entrega del cobrador y caja.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 3)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-3a-cobranza-y-cuadre.md (Task 2)
--
-- Amplía la política vehicles_select (el cobrador ve la moto). Cambia cuatro funciones vivas, partiendo de pg_get_functiondef (solo las líneas
-- necesarias):
--   caja_blocks_cash     93ab593dd439b34128ea03dd405f3bba  (deja pasar el cobro de la ruta)
--   close_caja_session   563589c0924270e3bbb312352bbfbd7d  (no cuenta los abonos en la calle)
--   void_loan_payment    037a7bb1224f44e829447e4200c3e850  (abono en la calle: caja según entrega)
--   void_credit_payment  fc95894567cde4e7b290f64455474774  (ídem)
-- No toca register_loan_payment, register_sale_payment ni register_customer_payment:
-- la RPC de la ruta los llama con `app.cobranza = on` (solo dura su transacción;
-- PostgREST no expone set_config) y marca el abono que crean.
--
-- Cómo cuadra la caja: un abono en efectivo de la ruta queda `en_calle` (en el
-- bolsillo del cobrador). El cierre no lo cuenta nunca; el dinero entra con la
-- entrega, como un movimiento de entrada. Así no se cuenta dos veces.
-- Pruebas: supabase/tests/cobranza.sql

-- 1. Caja: el cobro de la ruta no exige caja abierta -------------------------------------

create or replace function public.caja_blocks_cash(p_company_id uuid, p_branch_id uuid)
returns boolean
language sql
set search_path to 'public'
as $function$
  -- El cobrador cobra en la calle: el efectivo no entra a la gaveta hasta la entrega.
  select coalesce(current_setting('app.cobranza', true), '') <> 'on'
     and is_module_enabled(p_company_id, 'caja', false)
     and (p_branch_id is null
          or (public.branch_uses_caja(p_branch_id)
              and not public.has_open_caja(p_branch_id)));
$function$;

-- 2. Cierre de caja: los abonos en la calle entran con la entrega ---------------------------

create or replace function public.close_caja_session(p_session_id uuid, p_closing_amount_declared numeric, p_notes text default null::text)
returns jsonb
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
  -- Uno cobrado en la calle entra con la entrega del cobrador (movimiento).
  v_credit_cash := coalesce((select sum(amount) from credit_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and voided_at is null and not en_calle
                  and date >= v_s.opened_at and date < now()), 0);
  v_loan_cash := coalesce((select sum(amount) from loan_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and voided_at is null and not en_calle
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

-- 3. Anular un abono de préstamo ---------------------------------------------------------------

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

-- 4. Anular un abono de venta ---------------------------------------------------------------------

create or replace function public.void_credit_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p          credit_payments%rowtype;
  v_sale_ent   jsonb;
  v_inst_ent   jsonb;
  v_sale       sales%rowtype;
  v_principal  numeric;
  v_user_name  text;
  v_session    caja_sessions%rowtype;
  v_balance    numeric;
  v_cash_out   boolean := false;
begin
  select * into v_p from credit_payments where id = p_payment_id for update;
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
  if v_p.kind = 'down_payment' then
    raise exception 'El abono inicial es parte de la venta: para revertirlo hay que anular la venta completa.';
  end if;
  if v_p.allocation is null then
    raise exception 'Este abono es anterior al registro de aplicación por cuota, así que no se puede revertir automáticamente. Corrígelo desde la base con respaldo.';
  end if;

  -- Las ventas del abono se bloquean ANTES de mirar si se refinanciaron: una
  -- refinanciación que corra a la vez tiene que terminar primero, o este
  -- chequeo leería el plan viejo y la anulación reabriría cuotas ya cerradas.
  perform 1 from sales
   where id in (select (se->>'sale_id')::uuid from jsonb_array_elements(v_p.allocation->'sales') se)
   order by id
   for update;

  if exists (
    select 1
      from jsonb_array_elements(v_p.allocation->'sales') se
      join sales s on s.id = (se->>'sale_id')::uuid
      cross join lateral jsonb_array_elements(coalesce(se->'installments', '[]'::jsonb)) ie
      join financing_installments fi on fi.id = (ie->>'id')::uuid
     where s.financing_details ? 'firstInstallment'
       and fi.installment_number < (s.financing_details->>'firstInstallment')::int
  ) then
    raise exception 'Este abono es anterior a una refinanciación: no se puede anular.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  -- El efectivo tiene que salir de una caja abierta. Si el abono se cobró
  -- dentro de la sesión que sigue abierta, basta con excluirlo del cierre
  -- (`close_caja_session` ya ignora los anulados); si fue en una sesión
  -- anterior, esa ya cerró con el dinero contado y hay que sacarlo ahora.
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

  for v_sale_ent in select * from jsonb_array_elements(v_p.allocation->'sales')
  loop
    v_principal := coalesce((v_sale_ent->>'principal')::numeric, 0);

    select * into v_sale from sales where id = (v_sale_ent->>'sale_id')::uuid for update;
    if found then
      update sales
         set amount_paid = greatest(round(amount_paid - v_principal, 2), 0),
             payment_status = case
               when greatest(amount_paid - v_principal, 0) >=
                    case when sale_is_financed(financing_details)
                         then coalesce((financing_details->>'totalWithInterest')::numeric, total)
                         else total end - 0.01
                 then 'paid'::payment_status
               when sale_is_financed(financing_details) then 'in_financing'::payment_status
               else 'credit'::payment_status
             end
       where id = v_sale.id;
    end if;

    for v_inst_ent in select * from jsonb_array_elements(v_sale_ent->'installments')
    loop
      update financing_installments fi
         set paid_amount   = greatest(round(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 2), 0),
             late_fee_paid = greatest(round(fi.late_fee_paid - coalesce((v_inst_ent->>'late_fee')::numeric, 0), 2), 0),
             status = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then 'paid'
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) <= 0.005 then 'pending'
               else 'partial' end,
             paid_at = case
               when greatest(fi.paid_amount - coalesce((v_inst_ent->>'principal')::numeric, 0), 0) >= fi.amount - 0.005 then fi.paid_at
               else null end
       where fi.id = (v_inst_ent->>'id')::uuid;
    end loop;
  end loop;

  update credit_payments
     set voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_user_name, void_reason = btrim(p_reason)
   where id = p_payment_id;

  if v_cash_out then
    insert into caja_movements
      (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
    values
      (v_session.id, v_p.company_id, v_p.branch_id, 'out', v_p.amount,
       'Anulación de abono del ' || to_char(v_p.date, 'DD/MM/YYYY') || ': ' || btrim(p_reason),
       auth.uid(), v_user_name);
  end if;

  v_balance := recompute_customer_balance(v_p.customer_id);

  return jsonb_build_object(
    'payment_id',       v_p.id,
    'amount',           v_p.amount,
    'cash_returned',    v_cash_out,
    'customer_balance', v_balance
  );
end;
$function$;

-- 5. Control de la ruta: ¿puede este usuario cobrarle a este cliente aquí? ------------------
-- Devuelve el registro de cobrador del usuario en la sucursal.

create or replace function public.cobranza_control_de_ruta(p_branch_id uuid, p_customer_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cobrador uuid;
begin
  if not public.is_module_enabled(public.current_company_id(), 'motoprestamos', false) then
    raise exception 'El módulo Motopréstamos está apagado.';
  end if;
  v_cobrador := public.cobranza_mi_cobrador(p_branch_id);
  if v_cobrador is null then
    raise exception 'No estás registrado como cobrador en esta sucursal.';
  end if;
  if not public.cobranza_tengo_permiso(p_branch_id, 'cobranza', 'create') then
    raise exception 'No tienes permiso para cobrar en la calle.';
  end if;
  if not exists (select 1 from public.collection_assignments a
                  where a.branch_id = p_branch_id and a.customer_id = p_customer_id and a.collector_id = v_cobrador)
     and not public.cobranza_tengo_permiso(p_branch_id, 'cobranza-all', 'view') then
    raise exception 'Ese cliente no está en tu ruta.';
  end if;
  return v_cobrador;
end;
$$;

-- 6. Cobrar desde la ruta -----------------------------------------------------------------------
-- p_tipo: 'prestamo' (p_id = préstamo), 'venta' (p_id = venta) o 'cliente' (p_id =
-- cliente y p_branch_id = sucursal de la cartera: abono general a sus ventas).

create or replace function public.cobranza_registrar_abono(
  p_tipo text, p_id uuid, p_branch_id uuid, p_amount numeric, p_method text,
  p_reference text default null, p_notes text default null, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch   uuid;
  v_customer uuid;
  v_company  uuid;
  v_cobrador uuid;
  v_res      jsonb;
  v_pago     uuid;
begin
  if p_method not in ('cash', 'transfer') then
    raise exception 'Método de pago no válido.';
  end if;
  -- Sin señal el cobrador repite el cobro con el mismo identificador: se devuelve
  -- el abono que ya quedó, no se crea otro. El candado ordena dos envíos a la vez.
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    select v.payment_id into v_pago from public.collection_visits v
     where v.request_id = p_request_id and v.company_id = public.current_company_id();
    if found then
      return coalesce(
        (select jsonb_build_object('payment_id', id, 'amount', amount, 'late_fee_paid', late_fee_paid,
                                   'principal_paid', amount - late_fee_paid, 'en_calle', en_calle)
           from public.loan_payments where id = v_pago),
        (select jsonb_build_object('payment_id', id, 'amount', amount, 'late_fee_paid', late_fee_paid,
                                   'principal_paid', amount - late_fee_paid, 'en_calle', en_calle)
           from public.credit_payments where id = v_pago),
        jsonb_build_object('payment_id', v_pago)) || jsonb_build_object('repetido', true);
    end if;
  end if;
  if p_tipo = 'prestamo' then
    select branch_id, customer_id, company_id into v_branch, v_customer, v_company from public.loans where id = p_id;
  elsif p_tipo = 'venta' then
    select branch_id, customer_id, company_id into v_branch, v_customer, v_company from public.sales where id = p_id;
  elsif p_tipo = 'cliente' then
    select p_branch_id, id, company_id into v_branch, v_customer, v_company from public.customers where id = p_id;
  else
    raise exception 'Tipo de cobro no válido.';
  end if;
  if v_customer is null or v_branch is null or v_company is distinct from public.current_company_id() then
    raise exception 'Cuenta no encontrada.';
  end if;

  v_cobrador := public.cobranza_control_de_ruta(v_branch, v_customer);

  -- El efectivo va al bolsillo del cobrador: la RPC de siempre no pide caja abierta.
  perform set_config('app.cobranza', 'on', true);
  if p_tipo = 'prestamo' then
    v_res := public.register_loan_payment(p_id, p_amount, p_method, v_branch, p_notes, p_reference);
  elsif p_tipo = 'venta' then
    v_res := public.register_sale_payment(p_id, p_amount, p_method, v_branch, p_notes, p_reference);
  else
    v_res := public.register_customer_payment(p_id, p_amount, p_method, v_branch, p_notes, p_reference);
  end if;
  perform set_config('app.cobranza', 'off', true);

  v_pago := (v_res->>'payment_id')::uuid;
  if p_tipo = 'prestamo' then
    update public.loan_payments set collector_id = v_cobrador, en_calle = (p_method = 'cash') where id = v_pago;
  else
    update public.credit_payments set collector_id = v_cobrador, en_calle = (p_method = 'cash') where id = v_pago;
  end if;

  insert into public.collection_visits (company_id, branch_id, customer_id, collector_id, outcome, note, payment_id, request_id, created_by_name)
  values (v_company, v_branch, v_customer, v_cobrador, 'pago', nullif(btrim(coalesce(p_notes, '')), ''), v_pago, p_request_id,
          (select name from public.profiles where id = auth.uid()));

  return v_res || jsonb_build_object('payment_id', v_pago, 'en_calle', p_method = 'cash');
end;
$$;

-- 7. Anotar una visita sin pago ------------------------------------------------------------------

create or replace function public.cobranza_registrar_visita(
  p_branch_id uuid, p_customer_id uuid, p_outcome text,
  p_promise_date date default null, p_promise_amount numeric default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cobrador uuid;
  v_id       uuid;
begin
  if p_outcome not in ('no_estaba', 'no_tenia', 'promesa', 'se_nego', 'moto_no_aparece') then
    raise exception 'Resultado de la visita no válido.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and company_id = public.current_company_id()) then
    raise exception 'Cliente no encontrado.';
  end if;
  v_cobrador := public.cobranza_control_de_ruta(p_branch_id, p_customer_id);
  insert into public.collection_visits
    (company_id, branch_id, customer_id, collector_id, outcome, promise_date, promise_amount, note, created_by_name)
  values
    (public.current_company_id(), p_branch_id, p_customer_id, v_cobrador, p_outcome,
     case when p_outcome = 'promesa' then p_promise_date end,
     case when p_outcome = 'promesa' then p_promise_amount end,
     nullif(btrim(coalesce(p_note, '')), ''),
     (select name from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- 8. Recibir la entrega del cobrador ----------------------------------------------------------------

create or replace function public.cobranza_recibir_entrega(p_collector_id uuid, p_received numeric, p_note text default null, p_expected numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col      public.collectors%rowtype;
  v_expected numeric;
  v_cuantos  integer;
  v_session  public.caja_sessions%rowtype;
  v_mov      uuid;
  v_set      uuid;
  v_usuario  text := (select name from public.profiles where id = auth.uid());
  v_nombre   text;
  v_ids_prestamo  uuid[];
  v_ids_venta     uuid[];
  v_suma_prestamo numeric;
  v_suma_venta    numeric;
begin
  if p_received is null or p_received < 0 then
    raise exception 'El monto recibido no puede ser negativo.';
  end if;
  select * into v_col from public.collectors where id = p_collector_id;
  if not found or (v_col.company_id <> public.current_company_id() and not public.is_super_admin()) then
    raise exception 'Cobrador no encontrado.';
  end if;
  if not public.cobranza_tengo_permiso(v_col.branch_id, 'cobranza-cuadre', 'create') then
    raise exception 'No tienes permiso para recibir entregas de cobradores.';
  end if;

  -- Se bloquean y se guardan los abonos pendientes: la suma y la liquidación usan
  -- exactamente esos (uno que entre o se anule a la vez espera o queda fuera).
  select coalesce(array_agg(id), '{}'), coalesce(sum(amount), 0) into v_ids_prestamo, v_suma_prestamo from (
    select id, amount from public.loan_payments
     where collector_id = v_col.id and branch_id = v_col.branch_id and method = 'cash'
       and en_calle and settlement_id is null and voided_at is null
     for update) x;
  select coalesce(array_agg(id), '{}'), coalesce(sum(amount), 0) into v_ids_venta, v_suma_venta from (
    select id, amount from public.credit_payments
     where collector_id = v_col.id and branch_id = v_col.branch_id and method = 'cash'
       and en_calle and settlement_id is null and voided_at is null
     for update) x;
  v_expected := v_suma_prestamo + v_suma_venta;
  v_cuantos := cardinality(v_ids_prestamo) + cardinality(v_ids_venta);
  if v_cuantos = 0 then
    raise exception 'Este cobrador no tiene abonos en efectivo sin entregar.';
  end if;
  -- El cajero contó contra lo que vio: si cambió mientras contaba, que lo vea.
  if p_expected is not null and round(p_expected, 2) <> round(v_expected, 2) then
    raise exception 'Lo cobrado cambió mientras contabas: ahora son RD$%. Vuelve a abrir la entrega.', to_char(v_expected, 'FM999,999,990.00');
  end if;

  select name into v_nombre from public.profiles where id = v_col.profile_id;

  -- Con caja en la sucursal, lo recibido entra a la caja abierta.
  if public.is_module_enabled(v_col.company_id, 'caja', false) and public.branch_uses_caja(v_col.branch_id) then
    select * into v_session from public.caja_sessions
     where branch_id = v_col.branch_id and status = 'open' for update;
    if not found then
      raise exception 'Abre la caja de esta sucursal para recibir la entrega.';
    end if;
    if p_received > 0 then
      insert into public.caja_movements (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values (v_session.id, v_col.company_id, v_col.branch_id, 'in', p_received,
              'Entrega del cobrador ' || coalesce(v_nombre, ''), auth.uid(), v_usuario)
      returning id into v_mov;
    end if;
  end if;

  insert into public.collector_settlements
    (company_id, branch_id, collector_id, expected, received, note, caja_movement_id, received_by_name)
  values
    (v_col.company_id, v_col.branch_id, v_col.id, v_expected, p_received,
     nullif(btrim(coalesce(p_note, '')), ''), v_mov, v_usuario)
  returning id into v_set;

  update public.loan_payments set settlement_id = v_set where id = any(v_ids_prestamo);
  update public.credit_payments set settlement_id = v_set where id = any(v_ids_venta);

  return jsonb_build_object(
    'settlement_id', v_set,
    'expected',      v_expected,
    'received',      p_received,
    'difference',    p_received - v_expected,
    'payments',      v_cuantos
  );
end;
$$;

-- 9. El cobrador ve las motos de su sucursal (la placa en la ruta) -------------------------
-- vehicles_select viva (20261124150000_motos_vehiculos.sql) más cobranza:view. Solo lectura:
-- crear y editar siguen pidiendo el permiso motos.

drop policy vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select using (
    ((company_id = public.current_company_id())
     and (public.motos_tiene_permiso(branch_id, 'motos', 'view')
          or public.motos_tiene_permiso(branch_id, 'pos', 'view')
          or public.cobranza_tengo_permiso(branch_id, 'cobranza', 'view')))
    or public.is_super_admin());

-- 10. Grants --------------------------------------------------------------------------------------------

revoke execute on function public.cobranza_control_de_ruta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cobranza_control_de_ruta(uuid, uuid) to service_role;
revoke execute on function public.cobranza_registrar_abono(text, uuid, uuid, numeric, text, text, text, uuid) from public, anon;
revoke execute on function public.cobranza_registrar_visita(uuid, uuid, text, date, numeric, text) from public, anon;
revoke execute on function public.cobranza_recibir_entrega(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.cobranza_registrar_abono(text, uuid, uuid, numeric, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.cobranza_registrar_visita(uuid, uuid, text, date, numeric, text) to authenticated, service_role;
grant execute on function public.cobranza_recibir_entrega(uuid, numeric, text, numeric) to authenticated, service_role;
