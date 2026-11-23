-- Cobro diario y más cuotas en el motor de cuotas (préstamos y financiamiento).
-- Entrega 1 del módulo Motopréstamos: docs/superpowers/specs/2026-11-23-motoprestamos-design.md
--
-- Dos frecuencias nuevas que llevan el calendario en la frecuencia misma:
--   daily      → de lunes a sábado (salta los domingos); 26 cuotas = 1 mes de interés
--   daily_all  → todos los días;                          30 cuotas = 1 mes de interés
-- Como todas las funciones ya reciben la frecuencia, los domingos quedan
-- congelados en el plan sin columnas nuevas.
--
-- Tope de cuotas: 312 o 5 años, lo que se cumpla primero (max_installments).
-- Semanal, quincenal y mensual dan exactamente lo mismo que antes.
--
-- Todo parte de la definición viva (pg_get_functiondef) del 2026-11-23.
-- huella previa (md5 de prosrc sin \r):
--   financing_due_date         c0bc545361f692b350286029b5b56f53
--   financing_months           e7060d1e448c3d4ab2fdc68edd396c0b
--   late_fee_period_days       406d808f39e086885dfa82e6dd1abed7
--   validate_financing_params  02294ea70d165a21fc0e8fa56bb952c1
--   trg_before_loan_checks     6d2230edbed751b5b161c7f71ccd7031
--   pending_due_reminders      a63ac49c6b3863a93bc8c8574b6db82a
-- Pruebas: supabase/tests/cobro_diario.sql

-- 1. Las frecuencias que admiten las tablas -----------------------------------

alter table public.loans drop constraint loans_payment_frequency_check;
alter table public.loans add constraint loans_payment_frequency_check
  check (payment_frequency = any (array['daily', 'daily_all', 'weekly', 'biweekly', 'monthly']));

alter table public.companies drop constraint companies_financing_default_frequency_check;
alter table public.companies add constraint companies_financing_default_frequency_check
  check (financing_default_frequency = any (array['daily', 'daily_all', 'weekly', 'biweekly', 'monthly']));

alter table public.branches drop constraint branches_financing_default_frequency_check;
alter table public.branches add constraint branches_financing_default_frequency_check
  check (financing_default_frequency is null
         or financing_default_frequency = any (array['daily', 'daily_all', 'weekly', 'biweekly', 'monthly']));

-- Las cuotas por defecto de empresa y sucursal suben al tope más alto (312). La
-- frecuencia por defecto vive en otra columna (y en la sucursal puede heredarse
-- de la empresa), así que el tope exacto por frecuencia lo pone la pantalla.
alter table public.companies drop constraint companies_financing_default_installments_check;
alter table public.companies add constraint companies_financing_default_installments_check
  check (financing_default_installments >= 1 and financing_default_installments <= 312);

alter table public.branches drop constraint branches_financing_default_installments_check;
alter table public.branches add constraint branches_financing_default_installments_check
  check (financing_default_installments is null
         or (financing_default_installments >= 1 and financing_default_installments <= 312));

-- 2. Tope de cuotas por frecuencia (espejo: maxInstallments en src/lib/frequency.ts)

create or replace function public.max_installments(p_freq text)
 returns integer
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case p_freq
    when 'monthly'   then 60
    when 'biweekly'  then 120
    when 'weekly'    then 240
    when 'daily'     then 312
    when 'daily_all' then 312
  end;
$function$;

revoke execute on function public.max_installments(text) from public, anon;
grant execute on function public.max_installments(text) to authenticated, service_role;

-- 3. Fecha de la cuota k (espejo: addPeriods en src/lib/frequency.ts) ----------
-- En `daily` el domingo cuenta como el sábado: el día de cobro siguiente a los
-- dos es el lunes. Se ubica el inicio en una semana de 6 días (lun = 0 … sáb = 5),
-- se avanza k y se vuelve a fechas sumando semanas de 7.

create or replace function public.financing_due_date(p_start date, p_freq text, p_k integer)
 returns date
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_freq = 'daily' and p_k = 0 then p_start
    when p_freq = 'daily' then
      (p_start - (extract(isodow from p_start)::int - 1))
      + ((least(extract(isodow from p_start)::int - 1, 5) + p_k) / 6) * 7
      + ((least(extract(isodow from p_start)::int - 1, 5) + p_k) % 6)
    when p_freq = 'daily_all' then p_start + p_k
    when p_freq = 'weekly'    then p_start + (p_k * 7)
    when p_freq = 'biweekly'  then p_start + (p_k * 14)
    else (p_start + make_interval(months => p_k))::date
  end;
$function$;

-- 4. Meses de interés del plan ----------------------------------------------------

create or replace function public.financing_months(p_freq text, p_n integer, p_mode text)
 returns numeric
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_mode = 'per_installment' then p_n::numeric
    when p_freq = 'daily'           then p_n / 26.0
    when p_freq = 'daily_all'       then p_n / 30.0
    when p_freq = 'weekly'          then p_n / 4.0
    when p_freq = 'biweekly'        then p_n / 2.0
    else p_n::numeric
  end;
$function$;

-- 5. Período de la mora ----------------------------------------------------------

create or replace function public.late_fee_period_days(p_freq text)
 returns integer
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case p_freq
    when 'daily'     then 1
    when 'daily_all' then 1
    when 'weekly'    then 7
    when 'biweekly'  then 14
    else 30
  end;
$function$;

-- 6. Validación de planes de financiamiento (y de las refinanciaciones) ----------
-- Primero la frecuencia: con una frecuencia inválida no hay tope que mostrar.

create or replace function public.validate_financing_params(p_rate numeric, p_n integer, p_freq text, p_mode text)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if p_freq is null or p_freq not in ('daily','daily_all','weekly','biweekly','monthly') then
    raise exception 'Frecuencia de pago no válida.';
  end if;
  if p_n is null or p_n < 1 or p_n > max_installments(p_freq) then
    raise exception 'La cantidad de cuotas debe estar entre 1 y %.', max_installments(p_freq);
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'La tasa de interés no es válida.';
  end if;
  if p_mode not in ('monthly_prorated','per_installment') then
    raise exception 'Modo de interés no válido.';
  end if;
end;
$function$;

-- 7. Préstamos: frecuencias, tope y meses con las mismas funciones ---------------

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

-- 8. Avisos por correo: los planes diarios se cobran por la ruta, no por correo --

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
     and c.status::text <> 'suspended'
     and coalesce(s.financing_details->>'frequency', 'monthly') not in ('daily', 'daily_all')
     and fi.due_date <= public.company_today(s.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> '';
$function$;
