-- Las default privileges de Supabase (`alter default privileges ... grant all
-- on functions to anon, authenticated, service_role`) le dan EXECUTE a `anon`
-- a toda función nueva, y un `revoke all ... from public` no toca ese grant
-- directo. Lo cazaron los advisors tras la migración anterior.
--
-- Las funciones de cobro se defienden solas (sin sesión, current_company_id()
-- es null y rechazan), pero mueven dinero: no tienen por qué estar al alcance
-- de una llamada sin autenticar. Las dos internas (`apply_payment_to_sale` y
-- `recompute_customer_balance`) no las llama nadie de fuera: corren dentro de
-- las RPC SECURITY DEFINER, con los privilegios del dueño.

revoke execute on function public.company_today(uuid) from anon;
revoke execute on function public.can_collect_sale(uuid) from anon;
revoke execute on function public.apply_payment_to_sale(uuid, numeric, numeric, date, int) from anon, authenticated;
revoke execute on function public.recompute_customer_balance(uuid) from anon, authenticated;
revoke execute on function public.void_credit_payment(uuid, text) from anon;
revoke execute on function public.register_sale_payment(uuid, numeric, text, uuid, text, text) from anon;
revoke execute on function public.register_customer_payment(uuid, numeric, text, uuid, text, text) from anon;
revoke execute on function public.register_loan_payment(uuid, numeric, text, uuid, text, text) from anon;
