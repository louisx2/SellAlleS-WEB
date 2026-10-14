-- Los advisors marcan `function_search_path_mutable` en las funciones nuevas:
-- sin search_path fijo, quien las llame puede cambiar a qué esquema resuelven
-- los nombres de adentro. Es el mismo `set search_path to 'public'` que ya
-- llevan todas las demás funciones del proyecto.
alter function public.financing_months(text, int, text) set search_path to 'public';
alter function public.financing_plan(numeric, numeric, int, text, text) set search_path to 'public';
alter function public.financing_due_date(date, text, int) set search_path to 'public';
alter function public.validate_financing_params(numeric, int, text, text) set search_path to 'public';
