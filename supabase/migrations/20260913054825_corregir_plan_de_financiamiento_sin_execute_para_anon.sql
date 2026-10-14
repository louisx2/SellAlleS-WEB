-- Las default privileges de Supabase le dan EXECUTE a `anon` a toda función
-- nueva con un grant directo, y el `revoke all ... from public` de la
-- migración anterior no lo toca. Mismo tropiezo que `cobros_sin_execute_para_anon`.
revoke execute on function public.amend_sale_financing(uuid, numeric, int, text, text, text) from anon;
revoke execute on function public.financing_months(text, int, text) from anon;
revoke execute on function public.financing_plan(numeric, numeric, int, text, text) from anon;
revoke execute on function public.financing_due_date(date, text, int) from anon;
revoke execute on function public.validate_financing_params(numeric, int, text, text) from anon;
