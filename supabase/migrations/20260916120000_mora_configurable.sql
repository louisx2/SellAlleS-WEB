-- ════════════════════════════════════════════════════════════════════════════
-- Mora configurable: multa única, mora diaria o cargo por período
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hasta aquí la mora era un cargo ÚNICO por cuota vencida (cuota × tasa%), sin
-- importar si el atraso era de un día o de dos años, y sin importar cuánto de
-- esa cuota ya estaba abonado. Eso no es lo que cobra una financiera: no
-- presiona al que se atrasa mucho y castiga igual al que abonó casi todo.
--
-- Ahora la mora es una POLÍTICA de cuatro campos:
--
--   modo    'once'       multa fija: cuota × tasa%, una sola vez.
--           'daily'      interés moratorio: saldo vencido × tasa% mensual,
--                        prorrateado por día (tasa/30 por día de atraso).
--           'per_period' saldo vencido × tasa% por cada período de atraso
--                        cumplido (el período es el de la frecuencia del plan:
--                        semanal 7, quincenal 14, mensual 30).
--   tasa    % (mensual en 'daily'; de la cuota en 'once' y 'per_period').
--   gracia  días después del vencimiento antes de que empiece a correr.
--   tope    % máximo de mora sobre la base. 0 = sin tope. Imprescindible en
--           'daily': sin él una cuota olvidada acumula sin techo.
--
-- Dos bases distintas, a propósito:
--   · 'once' es una MULTA por incumplir, así que cae sobre la cuota pactada.
--   · 'daily' y 'per_period' son INTERESES por el dinero que sigue en la calle,
--     así que corren sobre el saldo insoluto: abonar baja la mora que corre.
--
-- ── Nada de esto toca lo que ya está vendido ────────────────────────────────
-- La política se CONGELA en cada venta (`financing_details`) y en cada préstamo
-- (columnas nuevas en `loans`) al crearlos. Un contrato vivo sin política
-- congelada no tiene `lateFeeMode`, y la ausencia resuelve a 'once' con la
-- tasa y la gracia de la empresa: exactamente lo que se le venía cobrando.
-- Cambiar los ajustes de hoy en adelante solo alcanza a lo que se venda mañana.
--
-- ── De paso se arreglan cuatro cosas ────────────────────────────────────────
-- 1. La mora de préstamos no se congelaba: subir `loan_late_fee_rate`
--    repreciaba retroactivamente todos los préstamos vivos.
-- 2. `late_fee_grace_days` existía en la base y la usaban los dos motores, pero
--    no había manera de configurarla salvo por SQL, ni override por sucursal.
-- 3. Préstamos y financiamiento compartían la misma gracia aunque sus tasas ya
--    eran independientes. Ahora `loan_late_fee_grace_days` es suya (se puebla
--    con la que tenían, para no mover a nadie).
-- 4. La fórmula estaba copiada en seis lugares (dos motores, el techo del abono
--    general, dos reportes, el cliente). Ahora hay UNA función en la base y su
--    espejo exacto en `src/lib/late-fee.ts`.

-- ── 1. Ajustes de empresa ───────────────────────────────────────────────────

alter table public.companies
  add column if not exists late_fee_mode            text    not null default 'once',
  add column if not exists late_fee_max_rate        numeric not null default 0,
  add column if not exists loan_late_fee_mode       text    not null default 'once',
  add column if not exists loan_late_fee_grace_days int     not null default 0,
  add column if not exists loan_late_fee_max_rate   numeric not null default 0;

-- Préstamos venía usando la gracia de financiamiento. Se copia para que la
-- separación no le cambie el cobro a nadie.
update public.companies
   set loan_late_fee_grace_days = late_fee_grace_days
 where loan_late_fee_grace_days = 0
   and late_fee_grace_days <> 0;

alter table public.companies drop constraint if exists companies_late_fee_mode_check;
alter table public.companies add constraint companies_late_fee_mode_check
  check (late_fee_mode in ('once','daily','per_period'));

alter table public.companies drop constraint if exists companies_loan_late_fee_mode_check;
alter table public.companies add constraint companies_loan_late_fee_mode_check
  check (loan_late_fee_mode in ('once','daily','per_period'));

alter table public.companies drop constraint if exists companies_late_fee_max_rate_check;
alter table public.companies add constraint companies_late_fee_max_rate_check
  check (late_fee_max_rate >= 0 and late_fee_max_rate <= 1000);

alter table public.companies drop constraint if exists companies_loan_late_fee_max_rate_check;
alter table public.companies add constraint companies_loan_late_fee_max_rate_check
  check (loan_late_fee_max_rate >= 0 and loan_late_fee_max_rate <= 1000);

alter table public.companies drop constraint if exists companies_late_fee_grace_days_check;
alter table public.companies add constraint companies_late_fee_grace_days_check
  check (late_fee_grace_days >= 0 and late_fee_grace_days <= 365);

alter table public.companies drop constraint if exists companies_loan_late_fee_grace_days_check;
alter table public.companies add constraint companies_loan_late_fee_grace_days_check
  check (loan_late_fee_grace_days >= 0 and loan_late_fee_grace_days <= 365);

comment on column public.companies.late_fee_mode is
  'Cómo corre la mora de ventas financiadas: once (multa fija), daily (tasa mensual prorrateada por día) o per_period (un cargo por período de atraso).';
comment on column public.companies.late_fee_max_rate is
  'Tope de mora como % de la base, por cuota. 0 = sin tope.';
comment on column public.companies.loan_late_fee_grace_days is
  'Días de gracia de préstamos. Independiente de la de financiamiento desde esta migración; se pobló con la que se venía usando.';

-- ── 2. Overrides por sucursal (financiamiento; préstamos van por empresa) ───

alter table public.branches
  add column if not exists late_fee_mode       text,
  add column if not exists late_fee_grace_days int,
  add column if not exists late_fee_max_rate   numeric;

alter table public.branches drop constraint if exists branches_late_fee_mode_check;
alter table public.branches add constraint branches_late_fee_mode_check
  check (late_fee_mode is null or late_fee_mode in ('once','daily','per_period'));

alter table public.branches drop constraint if exists branches_late_fee_grace_days_check;
alter table public.branches add constraint branches_late_fee_grace_days_check
  check (late_fee_grace_days is null or (late_fee_grace_days >= 0 and late_fee_grace_days <= 365));

alter table public.branches drop constraint if exists branches_late_fee_max_rate_check;
alter table public.branches add constraint branches_late_fee_max_rate_check
  check (late_fee_max_rate is null or (late_fee_max_rate >= 0 and late_fee_max_rate <= 1000));

comment on column public.branches.late_fee_mode is
  'Override de la sucursal. NULL = hereda de la empresa, igual que late_fee_rate.';

-- ── 3. Política congelada en el préstamo ────────────────────────────────────
-- NULL en los préstamos que ya existen: sin política congelada se cae al modo
-- legacy ('once' con los ajustes de la empresa), que es como se les ha cobrado.

alter table public.loans
  add column if not exists late_fee_rate       numeric,
  add column if not exists late_fee_mode       text,
  add column if not exists late_fee_grace_days int,
  add column if not exists late_fee_max_rate   numeric;

alter table public.loans drop constraint if exists loans_late_fee_mode_check;
alter table public.loans add constraint loans_late_fee_mode_check
  check (late_fee_mode is null or late_fee_mode in ('once','daily','per_period'));

alter table public.loans drop constraint if exists loans_late_fee_rate_check;
alter table public.loans add constraint loans_late_fee_rate_check
  check (late_fee_rate is null or (late_fee_rate >= 0 and late_fee_rate <= 100));

alter table public.loans drop constraint if exists loans_late_fee_grace_days_check;
alter table public.loans add constraint loans_late_fee_grace_days_check
  check (late_fee_grace_days is null or (late_fee_grace_days >= 0 and late_fee_grace_days <= 365));

alter table public.loans drop constraint if exists loans_late_fee_max_rate_check;
alter table public.loans add constraint loans_late_fee_max_rate_check
  check (late_fee_max_rate is null or (late_fee_max_rate >= 0 and late_fee_max_rate <= 1000));

comment on column public.loans.late_fee_mode is
  'Política de mora congelada al desembolsar. NULL = préstamo anterior a la mora configurable: se cobra con el modo legacy (once + ajustes vigentes de la empresa).';

-- ── 4. El cálculo, en un solo lugar ─────────────────────────────────────────

create or replace function public.late_fee_period_days(p_freq text)
returns int
language sql
immutable
set search_path to 'public'
as $function$
  select case p_freq
    when 'weekly'   then 7
    when 'biweekly' then 14
    else 30
  end;
$function$;

comment on function public.late_fee_period_days(text) is
  'Días que dura un período de pago. Mensual se aproxima a 30 a propósito: la mora se prorratea, no cae en fecha fija como la cuota.';

-- Mora DEVENGADA por una cuota a la fecha `p_today`, antes de descontar lo ya
-- cobrado. Espejo exacto de `accruedLateFee` en src/lib/late-fee.ts: si cambia
-- una, cambia la otra.
create or replace function public.late_fee_accrued(
  p_amount      numeric,
  p_paid_amount numeric,
  p_due_date    date,
  p_today       date,
  p_rate        numeric,
  p_mode        text,
  p_grace_days  int,
  p_max_rate    numeric,
  p_period_days int
) returns numeric
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_mode  text    := coalesce(nullif(p_mode, ''), 'once');
  v_days  int;
  v_base  numeric;
  v_units numeric;
  v_fee   numeric;
begin
  if p_rate is null or p_rate <= 0 or p_due_date is null or p_today is null then
    return 0;
  end if;

  -- La gracia perdona sus días: la mora empieza a correr cuando se acaba, no
  -- retroactiva al vencimiento.
  v_days := p_today - p_due_date - coalesce(p_grace_days, 0);
  if v_days <= 0 then
    return 0;
  end if;

  if v_mode = 'once' then
    -- Multa por incumplir: sobre la cuota pactada, una vez.
    v_base  := greatest(coalesce(p_amount, 0), 0);
    v_units := 1;
  else
    -- Interés moratorio: sobre lo que sigue vencido de verdad.
    v_base := greatest(coalesce(p_amount, 0) - coalesce(p_paid_amount, 0), 0);
    if v_mode = 'daily' then
      v_units := v_days::numeric / 30;
    else
      v_units := ceil(v_days::numeric / greatest(coalesce(p_period_days, 30), 1));
    end if;
  end if;

  if v_base <= 0 then
    return 0;
  end if;

  v_fee := v_base * p_rate / 100 * v_units;

  if coalesce(p_max_rate, 0) > 0 then
    v_fee := least(v_fee, v_base * p_max_rate / 100);
  end if;

  return round(v_fee, 2);
end;
$function$;

comment on function public.late_fee_accrued(numeric, numeric, date, date, numeric, text, int, numeric, int) is
  'Mora devengada por una cuota (antes de restar lo cobrado). Única fuente de verdad del monto; su espejo en el cliente es accruedLateFee() de src/lib/late-fee.ts.';

-- Lo que falta cobrar de mora en una cuota. Nunca negativo: si el saldo bajó y
-- el devengado quedó por debajo de lo ya cobrado, no se devuelve nada.
create or replace function public.late_fee_due(
  p_amount        numeric,
  p_paid_amount   numeric,
  p_late_fee_paid numeric,
  p_due_date      date,
  p_today         date,
  p_rate          numeric,
  p_mode          text,
  p_grace_days    int,
  p_max_rate      numeric,
  p_period_days   int
) returns numeric
language sql
immutable
set search_path to 'public'
as $function$
  select greatest(
    public.late_fee_accrued(p_amount, p_paid_amount, p_due_date, p_today,
                            p_rate, p_mode, p_grace_days, p_max_rate, p_period_days)
    - coalesce(p_late_fee_paid, 0), 0);
$function$;

-- Política efectiva de una venta financiada. `p_details` es su
-- `financing_details`; sin `lateFeeMode` es un plan anterior a esta migración y
-- se resuelve al modo legacy con los ajustes que le tocaban.
create or replace function public.late_fee_policy(
  p_details  jsonb,
  p_co_rate  numeric,
  p_co_grace int
) returns table(rate numeric, fee_mode text, grace_days int, max_rate numeric, period_days int)
language sql
immutable
set search_path to 'public'
as $function$
  select
    coalesce((p_details->>'lateFeeRate')::numeric, p_co_rate, 5),
    coalesce(nullif(p_details->>'lateFeeMode', ''), 'once'),
    coalesce((p_details->>'lateFeeGraceDays')::int, p_co_grace, 0),
    coalesce((p_details->>'lateFeeMaxRate')::numeric, 0),
    public.late_fee_period_days(coalesce(nullif(p_details->>'frequency', ''), 'monthly'));
$function$;

comment on function public.late_fee_policy(jsonb, numeric, int) is
  'Resuelve la política de mora de una venta: la congelada en el plan manda; lo que no traiga cae al ajuste de la empresa y al modo once.';

create or replace function public.validate_late_fee_params(
  p_rate numeric, p_mode text, p_grace int, p_max_rate numeric
) returns void
language plpgsql
immutable
set search_path to 'public'
as $function$
begin
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'La tasa de mora debe estar entre 0 y 100.';
  end if;
  if coalesce(p_mode, 'once') not in ('once','daily','per_period') then
    raise exception 'Modo de mora no válido.';
  end if;
  if p_grace is null or p_grace < 0 or p_grace > 365 then
    raise exception 'Los días de gracia deben estar entre 0 y 365.';
  end if;
  if p_max_rate is null or p_max_rate < 0 or p_max_rate > 1000 then
    raise exception 'El tope de mora debe estar entre 0 y 1000.';
  end if;
end;
$function$;

grant execute on function public.late_fee_period_days(text) to authenticated, service_role;
grant execute on function public.late_fee_accrued(numeric, numeric, date, date, numeric, text, int, numeric, int) to authenticated, service_role;
grant execute on function public.late_fee_due(numeric, numeric, numeric, date, date, numeric, text, int, numeric, int) to authenticated, service_role;
grant execute on function public.late_fee_policy(jsonb, numeric, int) to authenticated, service_role;
revoke all on function public.validate_late_fee_params(numeric, text, int, numeric) from public, anon;

-- ── 5. Congelar la política al crear la venta ───────────────────────────────

create or replace function public.before_sale_credit_checks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer   customers%rowtype;
  v_rate       numeric;
  v_n          int;
  v_plan       jsonb;
  v_debt       numeric;
  v_freq       text;
  v_mode       text;
  v_late_rate  numeric;
  v_late_mode  text;
  v_grace      int;
  v_max_rate   numeric;
  v_mode_deflt text;
  v_fin_on     boolean;
begin
  if new.payment_status not in ('credit','in_financing') then
    return new;
  end if;

  if new.customer_id is null then
    raise exception 'Debe seleccionar un cliente para vender a crédito o financiar.';
  end if;

  select * into v_customer
    from customers
   where id = new.customer_id and company_id = new.company_id
   for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  if new.amount_paid < 0 then
    raise exception 'El abono inicial no puede ser negativo.';
  end if;

  if new.payment_status = 'in_financing' then
    if new.financing_details is null then
      raise exception 'Falta el plan de financiamiento.';
    end if;
    if new.amount_paid >= new.total then
      raise exception 'El abono inicial debe ser menor que el total para financiar.';
    end if;

    -- Ajustes efectivos: lo que tenga la sucursal manda, lo que no, se hereda
    -- de la empresa. Mismo criterio que el perfil del ticket.
    select coalesce(b.late_fee_rate, c.late_fee_rate, 5),
           coalesce(b.late_fee_mode, c.late_fee_mode, 'once'),
           coalesce(b.late_fee_grace_days, c.late_fee_grace_days, 0),
           coalesce(b.late_fee_max_rate, c.late_fee_max_rate, 0),
           coalesce(b.financing_interest_mode, c.financing_interest_mode, 'monthly_prorated'),
           coalesce(b.financing_enabled, true)
      into v_late_rate, v_late_mode, v_grace, v_max_rate, v_mode_deflt, v_fin_on
      from companies c
      left join branches b on b.id = new.branch_id and b.company_id = c.id
     where c.id = new.company_id;

    -- El interruptor de la sucursal se defiende aquí, no solo escondiendo el
    -- botón del POS.
    if new.branch_id is not null and not coalesce(v_fin_on, true) then
      raise exception 'Esta sucursal no tiene habilitado el financiamiento.';
    end if;

    v_rate := coalesce((new.financing_details->>'interestRate')::numeric, 0);
    v_n    := coalesce((new.financing_details->>'installments')::int, 0);
    -- Los planes viejos no traen estos dos campos: mensual prorrateado es
    -- exactamente lo que se venía cobrando.
    v_freq := coalesce(nullif(new.financing_details->>'frequency', ''), 'monthly');
    v_mode := coalesce(nullif(new.financing_details->>'interestMode', ''), v_mode_deflt);

    perform validate_financing_params(v_rate, v_n, v_freq, v_mode);
    perform validate_late_fee_params(v_late_rate, v_late_mode, v_grace, v_max_rate);

    -- Interés SIMPLE, prorrateado o por cuota según el modo (ver
    -- `financing_plan`). Los montos los calcula SIEMPRE el servidor: lo que
    -- manda el navegador es una propuesta.
    v_plan := financing_plan(new.total - new.amount_paid, v_rate, v_n, v_freq, v_mode);

    new.financing_details := jsonb_build_object(
      'interestRate',      v_rate,
      'interestMode',      v_mode,
      'frequency',         v_freq,
      'installments',      v_n,
      'installmentAmount', (v_plan->>'installment')::numeric,
      'totalWithInterest', (v_plan->>'debt')::numeric + new.amount_paid,
      'downPayment',       new.amount_paid,
      -- Congeladas: mover el ajuste de la sucursal no debe repreciar esta deuda.
      'lateFeeRate',       v_late_rate,
      'lateFeeMode',       v_late_mode,
      'lateFeeGraceDays',  v_grace,
      'lateFeeMaxRate',    v_max_rate
    );
    v_debt := (v_plan->>'debt')::numeric;
  else
    -- Crédito simple pagado completo en caja: se normaliza a 'paid'.
    if new.amount_paid >= new.total then
      new.payment_status := 'paid';
      return new;
    end if;
    v_debt := round(new.total - new.amount_paid, 2);
  end if;

  if v_customer.credit_limit is not null
     and v_customer.credit_balance + v_debt > v_customer.credit_limit then
    raise exception 'Límite de crédito excedido: disponible RD$%, deuda nueva RD$%.',
      to_char(greatest(v_customer.credit_limit - v_customer.credit_balance, 0), 'FM999,999,990.00'),
      to_char(v_debt, 'FM999,999,990.00');
  end if;

  return new;
end;
$function$;

-- ── 6. Congelar la política al desembolsar el préstamo ──────────────────────

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

  v_months := case new.payment_frequency
    when 'weekly'   then new.installments_count / 4.0
    when 'biweekly' then new.installments_count / 2.0
    else new.installments_count::numeric
  end;

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

-- ── 7. El motor de abonos a ventas ──────────────────────────────────────────
-- Cambia la firma: ya no recibe tasa/gracia/hoy, los resuelve de la venta. Así
-- no hay dos maneras de decidir qué mora se cobra.

drop function if exists public.apply_payment_to_sale(uuid, numeric, numeric, date, int);

create or replace function public.apply_payment_to_sale(
  p_sale_id uuid,
  p_amount  numeric
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale      sales%rowtype;
  v_is_fin    boolean;
  v_pol       record;
  v_today     date;
  v_total_due numeric;
  v_remaining numeric := p_amount;
  v_late      numeric := 0;
  v_capital   numeric := 0;
  v_inst      record;
  v_apply     numeric;
  v_fee_due   numeric;
  v_insts     jsonb := '[]'::jsonb;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venta no encontrada.';
  end if;

  v_is_fin := (v_sale.payment_status = 'in_financing');

  if v_is_fin then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;
  v_total_due := greatest(round(v_total_due, 2), 0);

  if v_is_fin then
    select p.* into v_pol
      from companies c,
           lateral late_fee_policy(v_sale.financing_details, c.late_fee_rate, c.late_fee_grace_days) p
     where c.id = v_sale.company_id;
    v_today := company_today(v_sale.company_id);

    perform 1 from financing_installments where sale_id = p_sale_id for update;

    -- 1) La mora primero, de la cuota más vieja a la más nueva.
    for v_inst in
      select * from financing_installments
       where sale_id = p_sale_id
         and status <> 'paid'
         and due_date + v_pol.grace_days < v_today
       order by installment_number
    loop
      exit when v_remaining <= 0;
      v_fee_due := late_fee_due(v_inst.amount, v_inst.paid_amount, v_inst.late_fee_paid,
                                v_inst.due_date, v_today,
                                v_pol.rate, v_pol.fee_mode, v_pol.grace_days,
                                v_pol.max_rate, v_pol.period_days);
      if v_fee_due > 0 then
        v_apply := least(v_remaining, v_fee_due);
        update financing_installments
           set late_fee_paid = late_fee_paid + v_apply
         where id = v_inst.id;
        v_late      := v_late + v_apply;
        v_remaining := v_remaining - v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', 0, 'late_fee', v_apply);
      end if;
    end loop;

    -- 2) Capital FIFO, sin pasarse de la deuda: lo que sobre se devuelve a
    --    quien llamó (el abono general lo lleva a la siguiente venta).
    v_remaining := least(v_remaining, v_total_due);
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
               status  = case when paid_amount + v_apply >= amount - 0.005 then 'paid' else 'partial' end,
               paid_at = case when paid_amount + v_apply >= amount - 0.005 then now() else paid_at end
         where id = v_inst.id;
        v_remaining := v_remaining - v_apply;
        v_capital   := v_capital + v_apply;
        v_insts := v_insts || jsonb_build_object(
          'id', v_inst.id, 'number', v_inst.installment_number,
          'principal', v_apply, 'late_fee', 0);
      end if;
    end loop;
  else
    -- Crédito simple: no hay plan de cuotas ni mora, solo saldo.
    v_capital := least(v_remaining, v_total_due);
  end if;

  if v_capital > 0 then
    update sales
       set amount_paid = amount_paid + v_capital,
           payment_status = case
             when v_is_fin
                  and amount_paid + v_capital >=
                      coalesce((financing_details->>'totalWithInterest')::numeric, total) - 0.01
               then 'paid'::payment_status
             when not v_is_fin and amount_paid + v_capital >= total - 0.01
               then 'paid'::payment_status
             else payment_status
           end
     where id = p_sale_id;
  end if;

  return jsonb_build_object(
    'sale_id',      p_sale_id,
    'principal',    round(v_capital, 2),
    'late_fee',     round(v_late, 2),
    'consumed',     round(v_capital + v_late, 2),
    'installments', v_insts
  );
end;
$function$;

comment on function public.apply_payment_to_sale(uuid, numeric) is
  'Interno: aplica un monto a una venta (mora primero, luego capital FIFO) con la política congelada en su plan, y devuelve el detalle para poder revertirlo. No valida permisos — eso lo hace la RPC que lo llama.';

revoke all on function public.apply_payment_to_sale(uuid, numeric) from public, anon, authenticated;

-- Mora exigible de una venta financiada ahora mismo. La usan el techo del abono
-- y los reportes, para que nadie vuelva a copiar la fórmula.
create or replace function public.sale_late_fee_due(p_sale_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(sum(
           public.late_fee_due(fi.amount, fi.paid_amount, fi.late_fee_paid,
                               fi.due_date, public.company_today(s.company_id),
                               p.rate, p.fee_mode, p.grace_days, p.max_rate, p.period_days)
         ), 0)
    from sales s
    join companies c on c.id = s.company_id
    cross join lateral public.late_fee_policy(s.financing_details, c.late_fee_rate, c.late_fee_grace_days) p
    join financing_installments fi on fi.sale_id = s.id and fi.status <> 'paid'
   where s.id = p_sale_id;
$function$;

grant execute on function public.sale_late_fee_due(uuid) to authenticated, service_role;

-- ── 8. Las RPC de abonos, ahora sin fórmula propia ──────────────────────────

create or replace function public.register_sale_payment(
  p_sale_id   uuid,
  p_amount    numeric,
  p_method    text,
  p_branch_id uuid default null,
  p_notes     text default null,
  p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale        sales%rowtype;
  v_total_due   numeric;
  v_late_due    numeric := 0;
  v_res         jsonb;
  v_payment_id  uuid;
  v_user_name   text;
  v_paid_count  int := 0;
  v_total_count int := 0;
  v_balance     numeric;
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

  -- La función salta RLS: el permiso se valida aquí, con el mismo criterio de
  -- la policy de `sales`.
  if not can_collect_sale(p_sale_id) then
    raise exception 'No tienes acceso a esta venta.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta está anulada.';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'Esta venta ya está saldada.';
  end if;
  if v_sale.payment_status not in ('credit','in_financing') then
    raise exception 'Esta venta no es a crédito ni financiada.';
  end if;

  -- La sucursal del cobro decide de qué caja sale/entra el dinero: tiene que
  -- ser de la misma empresa.
  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_sale.company_id;
    if not found then
      raise exception 'Sucursal no válida para esta venta.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_sale.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  if v_sale.payment_status = 'in_financing' then
    v_total_due := coalesce((v_sale.financing_details->>'totalWithInterest')::numeric, v_sale.total)
                   - v_sale.amount_paid;
    v_late_due  := sale_late_fee_due(p_sale_id);
  else
    v_total_due := v_sale.total - v_sale.amount_paid;
  end if;

  if p_amount > v_total_due + v_late_due + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda pendiente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'),
      to_char(v_total_due + v_late_due, 'FM999,999,990.00');
  end if;

  v_res := apply_payment_to_sale(p_sale_id, p_amount);

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, late_fee_paid, method,
     reference, notes, user_id, user_name, date, kind, allocation)
  values
    (v_sale.company_id, v_sale.id, v_sale.customer_id, p_branch_id, p_amount,
     (v_res->>'late_fee')::numeric, p_method, p_reference, p_notes,
     auth.uid(), v_user_name, now(), 'sale',
     jsonb_build_object('sales', jsonb_build_array(v_res)))
  returning id into v_payment_id;

  v_balance := recompute_customer_balance(v_sale.customer_id);

  select count(*) filter (where status = 'paid'), count(*)
    into v_paid_count, v_total_count
    from financing_installments
   where sale_id = p_sale_id;

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      (v_res->>'late_fee')::numeric,
    'principal_paid',     (v_res->>'principal')::numeric,
    'remaining_balance',  greatest(round(v_total_due - (v_res->>'principal')::numeric, 2), 0),
    'installments_paid',  v_paid_count,
    'installments_total', v_total_count,
    'customer_balance',   v_balance
  );
end;
$function$;

create or replace function public.register_customer_payment(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_branch_id   uuid default null,
  p_notes       text default null,
  p_reference   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer   customers%rowtype;
  v_max        numeric := 0;
  v_remaining  numeric;
  v_sale       record;
  v_res        jsonb;
  v_allocs     jsonb := '[]'::jsonb;
  v_late_total numeric := 0;
  v_principal  numeric := 0;
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
  if not (is_super_admin() or (v_customer.company_id = current_company_id()
          and (is_company_admin()
               or v_customer.branch_id is null
               or v_customer.branch_id in (select user_branch_ids())
               or branch_shares_with_me('clientes', v_customer.branch_id)
               or branch_shares_with_me('credito', v_customer.branch_id)))) then
    raise exception 'No tienes acceso a este cliente.';
  end if;

  if p_branch_id is not null then
    perform 1 from branches where id = p_branch_id and company_id = v_customer.company_id;
    if not found then
      raise exception 'Sucursal no válida para este cliente.';
    end if;
  end if;

  if p_method = 'cash' and caja_blocks_cash(v_customer.company_id, p_branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de cobrar en efectivo.';
  end if;

  -- El techo sale de las ventas, no de `credit_balance`: capital pendiente más
  -- la mora exigible, cada venta con SU política congelada.
  select coalesce(sum(deuda + mora), 0) into v_max
    from (
      select
        case when s.payment_status = 'in_financing'
             then coalesce((s.financing_details->>'totalWithInterest')::numeric, s.total) - s.amount_paid
             else s.total - s.amount_paid end as deuda,
        sale_late_fee_due(s.id) as mora
        from sales s
       where s.customer_id = p_customer_id
         and s.payment_status in ('credit','in_financing')
         and s.cancelled_at is null
         and can_collect_sale(s.id)
    ) t;

  if v_max <= 0.01 then
    raise exception 'Este cliente no tiene deuda pendiente que puedas cobrar desde esta sucursal.';
  end if;
  if p_amount > v_max + 0.01 then
    raise exception 'El abono (RD$%) excede la deuda del cliente (RD$%).',
      to_char(p_amount, 'FM999,999,990.00'), to_char(v_max, 'FM999,999,990.00');
  end if;

  -- Primero la venta con el vencimiento más viejo; si no tiene plan de cuotas,
  -- vale la fecha de la venta. Es el orden que espera cualquiera que cobre.
  v_remaining := p_amount;
  for v_sale in
    select s.id,
           coalesce((select min(fi.due_date) from financing_installments fi
                      where fi.sale_id = s.id and fi.status <> 'paid'),
                    (s.created_at at time zone coalesce(nullif(btrim(c.timezone), ''), 'America/Santo_Domingo'))::date) as orden
      from sales s
      join companies c on c.id = s.company_id
     where s.customer_id = p_customer_id
       and s.payment_status in ('credit','in_financing')
       and s.cancelled_at is null
       and can_collect_sale(s.id)
     order by orden, s.created_at
  loop
    exit when v_remaining <= 0.005;
    v_res := apply_payment_to_sale(v_sale.id, v_remaining);
    if (v_res->>'consumed')::numeric > 0 then
      v_allocs     := v_allocs || v_res;
      v_late_total := v_late_total + (v_res->>'late_fee')::numeric;
      v_principal  := v_principal + (v_res->>'principal')::numeric;
      v_remaining  := v_remaining - (v_res->>'consumed')::numeric;
    end if;
  end loop;

  if v_remaining > 0.01 then
    raise exception 'No se pudo aplicar RD$% del abono a ninguna venta abierta. Revisa el balance del cliente.',
      to_char(v_remaining, 'FM999,999,990.00');
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into credit_payments
    (company_id, sale_id, customer_id, branch_id, amount, late_fee_paid, method,
     reference, notes, user_id, user_name, date, kind, allocation)
  values
    (v_customer.company_id, null, p_customer_id, p_branch_id, p_amount,
     round(v_late_total, 2), p_method, p_reference, p_notes,
     auth.uid(), v_user_name, now(), 'customer',
     jsonb_build_object('sales', v_allocs))
  returning id into v_payment_id;

  v_balance := recompute_customer_balance(p_customer_id);

  return jsonb_build_object(
    'payment_id',         v_payment_id,
    'amount',             p_amount,
    'late_fee_paid',      round(v_late_total, 2),
    'principal_paid',     round(v_principal, 2),
    'remaining_balance',  v_balance,
    'installments_paid',  null,
    'installments_total', null,
    'customer_balance',   v_balance,
    'sales_touched',      jsonb_array_length(v_allocs)
  );
end;
$function$;

revoke all on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;
revoke all on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;

-- ── 9. El motor de abonos a préstamos ───────────────────────────────────────

create or replace function public.register_loan_payment(
  p_loan_id   uuid,
  p_amount    numeric,
  p_method    text,
  p_branch_id uuid default null,
  p_notes     text default null,
  p_reference text default null
) returns jsonb
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

revoke all on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) to authenticated, service_role;

-- ── 10. El portal del cliente ve la misma mora que la caja ──────────────────
-- Antes solo viajaban las dos tasas, así que el portal ignoraba la gracia y no
-- sabía nada de la política congelada: le mostraba al cliente una mora que no
-- era la que se le iba a cobrar.

create or replace function public.resolve_portal_customers(p_cedula text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
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
        )
      )), '[]'::jsonb)
      from sales s where s.customer_id = cu.id and s.payment_status in ('credit','in_financing')
    )
  )), '[]'::jsonb)
  from customers cu
  join companies c on c.id = cu.company_id
  where cu.rnc = p_cedula
    and public.is_module_enabled(c.id, 'customer-portal', false);
$function$;

-- ── 11. Los avisos de cuota, con la mora de verdad ──────────────────────────
-- `send-due-reminders` armaba el aviso en el edge function: decidía "vencida"
-- con la fecha UTC (a las 8 PM en RD ya era mañana) y no mencionaba la mora,
-- que es justo el número que hace que alguien pague. Ahora la fila sale de acá,
-- con la fecha del negocio y la mora calculada con la política del contrato.

create or replace function public.pending_due_reminders(p_days_ahead int default 3)
returns table(
  kind           text,
  installment_id uuid,
  company_name   text,
  customer_name  text,
  customer_email text,
  due_date       date,
  amount_due     numeric,
  late_fee       numeric,
  is_overdue     boolean
)
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
     and fi.due_date <= public.company_today(s.company_id) + greatest(coalesce(p_days_ahead, 3), 0)
     and cu.email is not null and btrim(cu.email) <> '';
$function$;

comment on function public.pending_due_reminders(int) is
  'Cuotas que tocan aviso (vencen pronto o ya vencieron) con su mora exigible, en la fecha del negocio. La llama send-due-reminders con service_role.';

revoke all on function public.pending_due_reminders(int) from public, anon, authenticated;
grant execute on function public.pending_due_reminders(int) to service_role;
