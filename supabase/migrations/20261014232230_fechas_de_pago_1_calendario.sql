-- Fechas de pago de los financiamientos (1 de 4): el calendario con primer
-- pago. Solo agrega funciones; la de 7 argumentos pasa a ser un atajo de la
-- nueva sin primer pago, que arma exactamente las mismas fechas que antes.

create or replace function public.sale_local_date(p_company_id uuid, p_ts timestamptz)
returns date
language sql
stable
set search_path to 'public'
as $function$
  select (p_ts at time zone coalesce(
            (select nullif(btrim(timezone), '') from companies where id = p_company_id),
            'America/Santo_Domingo'))::date;
$function$;

create or replace function public.financing_schedule_due_date(
  p_start date, p_first_due date, p_freq text, p_k int
) returns date
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_first_due is null then financing_due_date(p_start, p_freq, p_k)
    else financing_due_date(p_first_due, p_freq, p_k - 1)
  end;
$function$;

revoke all on function public.sale_local_date(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.financing_schedule_due_date(date, date, text, int) from public, anon;
grant execute on function public.sale_local_date(uuid, timestamptz) to service_role;
grant execute on function public.financing_schedule_due_date(date, date, text, int) to authenticated, service_role;

create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text,
  p_n int, p_installment numeric, p_debt numeric, p_first_due date
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k        int;
  v_amount numeric;
begin
  for k in 1..p_n loop
    v_amount := case when k < p_n then p_installment
                     else p_debt - p_installment * (p_n - 1) end;

    insert into financing_installments (company_id, sale_id, installment_number, due_date, amount)
    values (p_company_id, p_sale_id, k,
            financing_schedule_due_date(p_start, p_first_due, p_freq, k), v_amount);
  end loop;
end;
$function$;

revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) from public;
revoke all on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) from anon, authenticated;
grant execute on function public.build_financing_schedule(uuid, uuid, date, text, int, numeric, numeric, date) to service_role;

create or replace function public.build_financing_schedule(
  p_company_id uuid, p_sale_id uuid, p_start date, p_freq text,
  p_n int, p_installment numeric, p_debt numeric
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform build_financing_schedule(p_company_id, p_sale_id, p_start, p_freq,
                                   p_n, p_installment, p_debt, null::date);
end;
$function$;
