-- Correcciones de la revisión de la entrega 1 (Motopréstamos), sobre lo ya
-- aplicado de 20261124120000 y 20261124130000.
--
-- I-1. En un plan "Diario (lun–sáb)" una primera cuota elegida en domingo pasa
--      al lunes y las demás siguen el martes (antes quedaba en domingo y la mora
--      diaria corría desde ahí). Va en financing_schedule_due_date y no en
--      financing_due_date(…, 0): ahí la cuota 2 caería el mismo lunes.
-- I-2. El préstamo solo se crea en una sucursal de su empresa, y la salida de
--      efectivo solo va a una sesión de caja de esa empresa: la política de
--      `loans` deja a un admin poner cualquier branch_id.
--
-- financing_schedule_due_date parte de la definición viva del 2026-11-23
-- (huella 5059de28562471cf4e88d0d1496cfc5a). Los dos triggers parten de los
-- archivos de las migraciones anteriores, con sus comentarios (lo aplicado de
-- esas dos tenía algunos recortados).
-- Pruebas: supabase/tests/cobro_diario.sql y supabase/tests/desembolso_caja.sql

-- I-1 -------------------------------------------------------------------------

create or replace function public.financing_schedule_due_date(p_start date, p_first_due date, p_freq text, p_k integer)
 returns date
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_first_due is null then financing_due_date(p_start, p_freq, p_k)
    -- Plan de lunes a sábado con primer pago elegido en domingo: arranca el
    -- lunes (si no, la cuota 1 caería en domingo y la 2 el mismo lunes).
    when p_freq = 'daily' and extract(isodow from p_first_due) = 7
      then financing_due_date(p_first_due + 1, p_freq, p_k - 1)
    else financing_due_date(p_first_due, p_freq, p_k - 1)
  end;
$function$;

-- I-2 -------------------------------------------------------------------------

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

  -- La política de `loans` no ata la sucursal a la empresa para un admin: sin
  -- esto, una sucursal ajena llevaría la salida de efectivo a la caja de otra
  -- empresa.
  if not exists (select 1 from branches where id = new.branch_id and company_id = new.company_id) then
    raise exception 'Sucursal no válida.';
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
     where branch_id = new.branch_id and company_id = new.company_id and status = 'open'
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
