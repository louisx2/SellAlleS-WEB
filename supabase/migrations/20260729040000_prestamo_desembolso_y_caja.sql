-- El desembolso de un prestamo nunca salia de la caja.
--
-- close_caja_session suma los abonos de prestamo en efectivo como ENTRADA, pero
-- el dinero que se le entrega al cliente al crear el prestamo no se restaba en
-- ningun lado. Con los modulos Caja y Prestamos encendidos a la vez, todo
-- prestamo en efectivo aparecia como faltante al cerrar el turno, por el monto
-- exacto de lo prestado, y el cajero no tenia como explicarlo.
--
-- Se arregla por donde ya estaba resuelto el resto: el desglose del cierre no
-- se arma de movimientos manuales, sino consultando cada tabla (ventas, abonos
-- de credito, abonos de prestamo). El desembolso se suma a esa lista como una
-- salida mas. No se inserta un caja_movements: eso lo mezclaria con las salidas
-- manuales del turno y el cajero no distinguiria una cosa de la otra.
--
-- Para saber que desembolsos tocan la caja hace falta saber COMO se entrego el
-- dinero, que hasta ahora no se guardaba.

-- ── Como se entrego el dinero ───────────────────────────────────────────────

-- Solo efectivo y transferencia: prestar por tarjeta no existe (la tarjeta es
-- un medio de cobro, no de entrega). Los prestamos que ya estaban quedan como
-- 'cash', que es lo que eran en la practica.
alter table public.loans
  add column if not exists disbursement_method text not null default 'cash';

alter table public.loans
  drop constraint if exists loans_disbursement_method_check;
alter table public.loans
  add constraint loans_disbursement_method_check
  check (disbursement_method in ('cash','transfer'));

-- Numero de transferencia, para que quede constancia de por donde salio.
alter table public.loans
  add column if not exists disbursement_reference text;

comment on column public.loans.disbursement_method is
  'Como se entrego el dinero al cliente. Solo el efectivo mueve la caja de la sucursal.';

-- ── Prestar en efectivo exige caja abierta ──────────────────────────────────

-- Mismo criterio que ya rige para cobrar en efectivo (fn_require_open_caja_for
-- _cash_sale): si la empresa lleva caja, no se saca dinero de una gaveta que
-- nadie abrio. Si el modulo esta apagado, no aplica nada de esto.
create or replace function public.trg_before_loan_checks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer customers%rowtype;
  v_months   numeric;
  v_interest numeric;
begin
  select * into v_customer
    from customers
   where id = new.customer_id and company_id = new.company_id
   for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if new.principal is null or new.principal <= 0 then
    raise exception 'El monto del préstamo debe ser mayor que cero.';
  end if;
  if new.installments_count < 1 or new.installments_count > 60 then
    raise exception 'La cantidad de cuotas debe estar entre 1 y 60.';
  end if;
  if new.interest_rate < 0 or new.interest_rate > 100 then
    raise exception 'La tasa de interés no es válida.';
  end if;
  if new.payment_frequency not in ('weekly','biweekly','monthly') then
    raise exception 'Frecuencia de pago no válida.';
  end if;

  if new.disbursement_method = 'cash'
     and is_module_enabled(new.company_id, 'caja', false)
     and not has_open_caja(new.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal: no puedes entregar efectivo.';
  end if;

  v_months := case new.payment_frequency
    when 'weekly'   then new.installments_count / 4.0
    when 'biweekly' then new.installments_count / 2.0
    else new.installments_count::numeric
  end;

  v_interest := round(new.principal * new.interest_rate / 100 * v_months, 2);
  new.total_with_interest := new.principal + v_interest;
  new.amount_paid := 0;

  return new;
end;
$function$;

-- ── El cierre de caja descuenta lo prestado en efectivo ─────────────────────

create or replace function public.close_caja_session(
  p_session_id uuid,
  p_closing_amount_declared numeric,
  p_notes text default null::text
)
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
  v_loan_out    numeric;
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
  v_credit_cash := coalesce((select sum(amount) from credit_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and date >= v_s.opened_at and date < now()), 0);
  v_loan_cash := coalesce((select sum(amount) from loan_payments
                where branch_id = v_s.branch_id and method = 'cash'
                  and date >= v_s.opened_at and date < now()), 0);
  -- Lo prestado en efectivo durante el turno. Se cuenta el capital entregado
  -- (principal), no el total con interes: lo que salio de la gaveta es lo que
  -- el cliente se llevo en la mano.
  --
  -- Se incluyen los cancelados a proposito: cancelar un prestamo no devuelve el
  -- dinero por si solo, y si el efectivo ya salio tiene que seguir descontado.
  v_loan_out := coalesce((select sum(principal) from loans
                where branch_id = v_s.branch_id and disbursement_method = 'cash'
                  and created_at >= v_s.opened_at and created_at < now()), 0);
  v_mov_in := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'in'), 0);
  v_mov_out := coalesce((select sum(amount) from caja_movements
                where session_id = v_s.id and type = 'out'), 0);

  v_expected := v_s.opening_amount + v_cash_sales + v_credit_cash + v_loan_cash
                + v_mov_in - v_mov_out - v_loan_out;
  v_diff := p_closing_amount_declared - v_expected;

  v_breakdown := jsonb_build_object(
    'opening',            v_s.opening_amount,
    'cashSales',          v_cash_sales,
    'creditCashPayments', v_credit_cash,
    'loanCashPayments',   v_loan_cash,
    'loanDisbursements',  v_loan_out,
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

-- Los cierres viejos no traen 'loanDisbursements' en su breakdown. No se
-- rellenan: ese turno se cerro con otro numero esperado y reescribirlo ahora
-- seria inventar historia. La pantalla lo trata como ausente.
