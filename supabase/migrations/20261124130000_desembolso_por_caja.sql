-- El desembolso de un préstamo en efectivo sale de la caja.
-- Entrega 1 del módulo Motopréstamos: docs/superpowers/specs/2026-11-23-motoprestamos-design.md
--
-- Hasta hoy el dinero prestado no pasaba por la caja y el cierre no cuadraba en
-- un negocio que presta en efectivo. Ahora el préstamo dice cómo se entregó
-- (cash / transfer). En efectivo, con caja en la sucursal: exige caja abierta y
-- deja una salida enlazada al préstamo. Lo hacen los triggers de `loans`, así
-- que vale para el diálogo y para la refinanciación con dinero adicional (que
-- cambia lo decidido el 2026-10-15: ahora también sale de la caja).
--
-- Sin forma de entrega (préstamos viejos y el front viejo que sirve el SW) no se
-- exige nada ni se mueve la caja.
--
-- Va después de 20261124120000_cobro_diario_y_mas_cuotas.sql: trg_before_loan_checks
-- parte de esa versión. Lo demás, de la definición viva del 2026-11-23.
-- huella previa (md5 de prosrc sin \r):
--   trg_after_loan_effects  a641815602cce7ef6b9a58e6e2e3e876
--   refinance_loan          3316ef181e41cf5dced9ec00137659fa
-- Pruebas: supabase/tests/desembolso_caja.sql

-- 1. Columnas ---------------------------------------------------------------------

alter table public.loans
  add column disbursement_method text,
  add column disbursement_reference text;

alter table public.loans add constraint loans_disbursement_method_check
  check (disbursement_method is null or disbursement_method in ('cash', 'transfer'));

alter table public.caja_movements
  add column loan_id uuid references public.loans(id) on delete set null;

create index caja_movements_loan_id_idx on public.caja_movements (loan_id) where loan_id is not null;

-- 2. Antes de crear el préstamo: en efectivo hace falta la caja abierta ------------

create or replace function public.trg_before_loan_checks()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_customer  customers%rowtype;
  v_months    numeric;
  v_interest  numeric;
  v_late_rate numeric;
  v_late_mode text;
  v_grace     int;
  v_max_rate  numeric;
begin
  if coalesce(current_setting('app.refinance_loan', true), '') <> 'on'
     and (new.status = 'refinanced' or new.refinanced_from_id is not null
          or coalesce(new.carried_over_amount, 0) <> 0) then
    raise exception 'El enlace a otro préstamo solo lo pone una refinanciación.';
  end if;

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
  if new.payment_frequency not in ('daily','daily_all','weekly','biweekly','monthly') then
    raise exception 'Frecuencia de pago no válida.';
  end if;
  if new.installments_count < 1 or new.installments_count > max_installments(new.payment_frequency) then
    raise exception 'La cantidad de cuotas debe estar entre 1 y %.', max_installments(new.payment_frequency);
  end if;
  if new.interest_rate < 0 or new.interest_rate > 100 then
    raise exception 'La tasa de interés no es válida.';
  end if;
  if new.first_due_date is not null
     and (new.first_due_date <= company_today(new.company_id)
          or new.first_due_date > company_today(new.company_id) + 90) then
    raise exception 'La primera cuota tiene que caer después de hoy y a no más de 90 días.';
  end if;
  if new.disbursement_method = 'cash' and caja_blocks_cash(new.company_id, new.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de entregar el préstamo en efectivo.';
  end if;

  -- El préstamo siempre cobra tasa mensual prorrateada.
  v_months := financing_months(new.payment_frequency, new.installments_count, 'monthly_prorated');

  v_interest := round(new.principal * new.interest_rate / 100 * v_months, 2);
  new.total_with_interest := new.principal + v_interest;
  new.amount_paid := 0;

  -- La mora se congela igual que en financiamiento: subir el ajuste de la
  -- empresa no puede repreciar un préstamo que ya está corriendo. Lo que mande
  -- el navegador se ignora — esto lo decide el servidor.
  select coalesce(loan_late_fee_rate, 5),
         coalesce(loan_late_fee_mode, 'once'),
         coalesce(loan_late_fee_grace_days, 0),
         coalesce(loan_late_fee_max_rate, 0)
    into v_late_rate, v_late_mode, v_grace, v_max_rate
    from companies where id = new.company_id;

  perform validate_late_fee_params(v_late_rate, v_late_mode, v_grace, v_max_rate);

  new.late_fee_rate       := v_late_rate;
  new.late_fee_mode       := v_late_mode;
  new.late_fee_grace_days := v_grace;
  new.late_fee_max_rate   := v_max_rate;

  return new;
end;
$function$;

-- 3. Después de crearlo: las cuotas y, en efectivo, la salida de caja ------------
-- Sale lo que se entrega de verdad: en una refinanciación, solo el adicional
-- (principal − lo arrastrado del préstamo viejo).

create or replace function public.trg_after_loan_effects()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n        int := new.installments_count;
  v_cuota    numeric;
  v_debt     numeric;
  v_amount   numeric;
  v_due      date;
  k          int;
  v_entrega  numeric;
  v_session  uuid;
  v_cliente  text;
  v_usuario  text;
begin
  v_debt  := new.total_with_interest;
  v_cuota := round(v_debt / v_n, 2);

  for k in 1..v_n loop
    if k < v_n then
      v_amount := v_cuota;
    else
      v_amount := v_debt - v_cuota * (v_n - 1);
    end if;

    v_due := financing_schedule_due_date(new.created_at::date, new.first_due_date, new.payment_frequency, k);

    insert into public.loan_installments (company_id, loan_id, installment_number, due_date, amount)
    values (new.company_id, new.id, k, v_due, v_amount);
  end loop;

  v_entrega := new.principal - coalesce(new.carried_over_amount, 0);
  if new.disbursement_method = 'cash'
     and v_entrega > 0
     and is_module_enabled(new.company_id, 'caja', false)
     and branch_uses_caja(new.branch_id) then
    select id into v_session
      from caja_sessions
     where branch_id = new.branch_id and status = 'open'
     limit 1;

    if v_session is not null then
      select name into v_cliente from customers where id = new.customer_id;
      select name into v_usuario from profiles where id = auth.uid();

      insert into public.caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name, loan_id)
      values
        (v_session, new.company_id, new.branch_id, 'out', v_entrega,
         'Desembolso de préstamo: ' || coalesce(v_cliente, 'cliente'),
         auth.uid(), v_usuario, new.id);
    end if;
  end if;

  return new;
end;
$function$;

-- 4. Refinanciación: cómo se entrega el dinero adicional --------------------------
-- Dos parámetros nuevos al final, con default: el front viejo sigue llamando
-- con los 11 de antes. Se borra la firma vieja para que PostgREST no tenga dos
-- candidatas.

drop function public.refinance_loan(uuid, text, text, numeric, numeric, integer, text, date, text, numeric, numeric);

create function public.refinance_loan(p_loan_id uuid, p_base_mode text, p_late_fee_action text, p_additional numeric, p_interest_rate numeric, p_installments integer, p_frequency text, p_first_due date, p_reason text, p_expected_balance numeric default null::numeric, p_expected_late_fee numeric default null::numeric, p_disbursement_method text default null::text, p_disbursement_reference text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_loan      loans%rowtype;
  v_new       loans%rowtype;
  v_q         jsonb;
  v_today     date;
  v_late      numeric;
  v_action    text;
  v_carried   numeric;
  v_principal numeric;
  v_before    jsonb;
  v_user_name text;
  v_ref_id    uuid;
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found or (v_loan.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Préstamo no encontrado.';
  end if;
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede refinanciar.';
  end if;
  if v_loan.status = 'refinanced' then
    raise exception 'Este préstamo ya fue refinanciado: refinancia el préstamo nuevo.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indica el motivo de la refinanciación.';
  end if;
  if p_base_mode is null or p_base_mode not in ('capital', 'balance') then
    raise exception 'La base de la refinanciación no es válida.';
  end if;
  if p_additional is null or p_additional < 0 then
    raise exception 'El dinero adicional no puede ser negativo.';
  end if;
  if p_additional > 0 and p_disbursement_method is not null
     and p_disbursement_method not in ('cash', 'transfer') then
    raise exception 'Forma de entrega no válida.';
  end if;
  -- Los préstamos no tienen modo de interés: siempre prorrateado por mes.
  perform validate_financing_params(p_interest_rate, p_installments, p_frequency, 'monthly_prorated');

  v_q     := refinance_quote_data('loan', p_loan_id);
  v_today := (v_q->>'today')::date;

  if p_first_due is not null and p_first_due <= v_today then
    raise exception 'La primera cuota tiene que caer después de hoy.';
  end if;
  if (v_q->>'pending_balance')::numeric <= 0 then
    raise exception 'Este préstamo no tiene saldo pendiente.';
  end if;
  if (p_expected_balance is not null
      and abs((v_q->>'pending_balance')::numeric - p_expected_balance) > 0.005)
     or (p_expected_late_fee is not null
      and abs((v_q->>'late_fee_due')::numeric - p_expected_late_fee) > 0.005) then
    raise exception 'La deuda cambió desde que abriste la refinanciación: vuelve a abrirla para ver los montos de ahora.';
  end if;

  v_late := (v_q->>'late_fee_due')::numeric;
  if v_late > 0 then
    if p_late_fee_action is null or p_late_fee_action not in ('capitalize', 'forgive') then
      raise exception 'Hay mora pendiente: indica si se suma al capital o se perdona.';
    end if;
    v_action := p_late_fee_action;
  end if;

  v_carried := case p_base_mode
                 when 'capital' then (v_q->>'pending_capital')::numeric
                 else (v_q->>'pending_balance')::numeric
               end
               + case when v_action = 'capitalize' then v_late else 0 end;
  v_principal := v_carried + p_additional;

  v_before := jsonb_build_object(
    'loan', to_jsonb(v_loan),
    'installments', (select coalesce(jsonb_agg(to_jsonb(li) order by li.installment_number), '[]'::jsonb)
                       from loan_installments li where li.loan_id = p_loan_id));

  -- Cierre del préstamo viejo, con la misma regla que un financiamiento.
  update loan_installments
     set amount = paid_amount, status = 'paid', paid_at = coalesce(paid_at, now())
   where loan_id = p_loan_id and status <> 'paid' and (paid_amount > 0 or late_fee_paid > 0);
  delete from loan_installments
   where loan_id = p_loan_id and status <> 'paid';

  update loans
     set status = 'refinanced', total_with_interest = amount_paid
   where id = p_loan_id;

  select name into v_user_name from profiles where id = auth.uid();

  -- trg_before_loan_checks solo acepta el enlace y lo arrastrado con esta
  -- marca, que vive lo que dura la transacción y se apaga en cuanto se usa.
  -- La forma de entrega solo aplica al dinero adicional: sin adicional no hay
  -- nada que entregar.
  perform set_config('app.refinance_loan', 'on', true);
  insert into loans
    (company_id, branch_id, customer_id, principal, interest_rate, installments_count,
     payment_frequency, notes, created_by, user_name, refinanced_from_id, carried_over_amount,
     first_due_date, disbursement_method, disbursement_reference)
  values
    (v_loan.company_id, v_loan.branch_id, v_loan.customer_id, v_principal, p_interest_rate, p_installments,
     p_frequency,
     'Refinancia el préstamo del ' || to_char(sale_local_date(v_loan.company_id, v_loan.created_at), 'DD/MM/YYYY'),
     auth.uid(), v_user_name, v_loan.id, v_carried,
     coalesce(p_first_due, financing_due_date(v_today, p_frequency, 1)),
     case when p_additional > 0 then p_disbursement_method end,
     case when p_additional > 0 then nullif(btrim(coalesce(p_disbursement_reference, '')), '') end)
  returning * into v_new;
  perform set_config('app.refinance_loan', 'off', true);

  insert into refinancings
    (company_id, customer_id, kind, loan_id, new_loan_id, base_mode, pending_balance, pending_capital,
     unearned_interest, late_fee_amount, late_fee_action, additional_amount, new_principal,
     plan_before, plan_after, reason, created_by, created_by_name)
  values
    (v_loan.company_id, v_loan.customer_id, 'loan', v_loan.id, v_new.id, p_base_mode,
     (v_q->>'pending_balance')::numeric, (v_q->>'pending_capital')::numeric,
     (v_q->>'unearned_interest')::numeric, v_late, v_action, p_additional, v_principal,
     v_before,
     jsonb_build_object(
       'loan', to_jsonb(v_new),
       'installments', (select coalesce(jsonb_agg(to_jsonb(li) order by li.installment_number), '[]'::jsonb)
                          from loan_installments li where li.loan_id = v_new.id)),
     btrim(p_reason), auth.uid(), v_user_name)
  returning id into v_ref_id;

  return jsonb_build_object(
    'old_loan_id',         v_loan.id,
    'new_loan_id',         v_new.id,
    'refinancing_id',      v_ref_id,
    'new_principal',       v_principal,
    'carried_over_amount', v_carried,
    'total_with_interest', v_new.total_with_interest,
    'installment_amount',  (select amount from loan_installments where loan_id = v_new.id and installment_number = 1)
  );
end;
$function$;

revoke execute on function public.refinance_loan(uuid, text, text, numeric, numeric, integer, text, date, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.refinance_loan(uuid, text, text, numeric, numeric, integer, text, date, text, numeric, numeric, text, text) to authenticated, service_role;
