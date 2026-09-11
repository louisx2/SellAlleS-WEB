-- Dos arreglos de rendimiento que el linter de Supabase venía señalando, ambos
-- sin cambio de comportamiento: lo que se puede leer y escribir queda igual.
--
-- 1) auth.uid() y auth.jwt() dentro de una policy se reevalúan UNA VEZ POR FILA
--    examinada. Envueltos en un subselect, Postgres los resuelve una sola vez
--    por consulta y reutiliza el valor (initplan). Es la recomendación de
--    Supabase, y es equivalente: la función es estable dentro de la consulta.
--    En `sales` (12.7 mil filas) o `sale_items` (18.5 mil) esa diferencia se
--    nota en cada listado.
--
--    Se usa ALTER POLICY y no DROP+CREATE a propósito: así no existe ni un
--    instante en el que la tabla quede sin su policy.
--
-- 2) Nueve claves foráneas sin índice. Sin él, Postgres recorre la tabla hija
--    entera para resolver un join o comprobar un borrado en la tabla padre.

-- ---------------------------------------------------------------------------
-- 1. Policies: auth.<fn>() -> (select auth.<fn>())
-- ---------------------------------------------------------------------------

alter policy "companies_select" on public.companies
  using (
    (id = current_company_id())
    or is_super_admin()
    or (exists (
      select 1 from profile_companies pc
      where pc.profile_id = (select auth.uid()) and pc.company_id = companies.id
    ))
  );

alter policy "Super admins can manage all company modules" on public.company_modules
  using (
    (select profiles.is_super_admin from profiles where profiles.id = (select auth.uid())) = true
  )
  with check (
    (select profiles.is_super_admin from profiles where profiles.id = (select auth.uid())) = true
  );

alter policy "dashboard_external_entries_owner" on public.dashboard_external_entries
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

alter policy "Super Admins can manage all profile_companies" on public.profile_companies
  using (
    (select profiles.is_super_admin from profiles where profiles.id = (select auth.uid())) = true
  );

alter policy "Users can read their own profile_companies" on public.profile_companies
  using (profile_id = (select auth.uid()));

alter policy "profiles_insert" on public.profiles
  with check (
    (id = (select auth.uid())) or (company_id = current_company_id()) or is_super_admin()
  );

alter policy "profiles_select" on public.profiles
  using (
    (id = (select auth.uid())) or (company_id = current_company_id()) or is_super_admin()
  );

alter policy "profiles_update" on public.profiles
  using (
    (id = (select auth.uid())) or (company_id = current_company_id()) or is_super_admin()
  )
  with check (
    (id = (select auth.uid())) or (company_id = current_company_id()) or is_super_admin()
  );

-- Esta policy lee el tenant de un claim `company_id` del JWT, a diferencia del
-- resto del sistema, que usa current_company_id(). Convive con `suppliers_all`,
-- que sí concede por la vía normal, así que aquí solo se le quita el coste por
-- fila: decidir si además sobra es harina de otro costal y no se toca hoy.
alter policy "Allow tenant access" on public.suppliers
  using (company_id = (((select auth.jwt()) ->> 'company_id'::text))::uuid);

-- ---------------------------------------------------------------------------
-- 2. Índices que faltaban en claves foráneas
-- ---------------------------------------------------------------------------

-- Reportes de productos más vendidos, y el borrado de un producto, que hoy
-- recorre las 18.5 mil líneas de venta para comprobar si está referenciado.
create index if not exists sale_items_product_id_idx on public.sale_items (product_id);

-- Estado de cuenta e historial de crédito de un cliente.
create index if not exists sales_customer_id_idx on public.sales (customer_id);

-- Reporte de ventas por usuario.
create index if not exists sales_user_id_idx on public.sales (user_id);

-- Poco consultado, pero el índice es diminuto y evita el recorrido al borrar
-- una cotización.
create index if not exists sales_quote_id_idx on public.sales (quote_id);

-- Filtros del catálogo por categoría y por suplidor.
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists products_supplier_id_idx on public.products (supplier_id);

-- Cierres de caja: los movimientos se leen siempre acotados por empresa y
-- sucursal, y el detalle los agrupa por quien los registró.
create index if not exists caja_movements_company_id_idx on public.caja_movements (company_id);
create index if not exists caja_movements_branch_id_idx on public.caja_movements (branch_id);
create index if not exists caja_movements_created_by_idx on public.caja_movements (created_by);

-- ---------------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------------
do $comprobacion$
declare
  v_policies text;
  v_faltan   int;
begin
  -- Ninguna de las nueve puede seguir llamando a auth.<fn>() "desnudo".
  -- La comparación va con ~* y no con ~ porque Postgres reescribe lo que se le
  -- da: `(select auth.uid())` queda guardado como `( SELECT auth.uid() AS uid)`,
  -- y un lookbehind sensible a mayúsculas no reconocería ese SELECT.
  select string_agg(tablename || '.' || policyname, ', ') into v_policies
    from pg_policies
   where schemaname = 'public'
     and (qual ~* '(?<!select )auth\.(uid|role|jwt)\(\)'
          or with_check ~* '(?<!select )auth\.(uid|role|jwt)\(\)');

  if v_policies is not null then
    raise exception 'Siguen reevaluando auth por fila: %', v_policies;
  end if;

  select count(*) into v_faltan
    from (values
      ('sale_items_product_id_idx'), ('sales_customer_id_idx'), ('sales_user_id_idx'),
      ('sales_quote_id_idx'), ('products_category_id_idx'), ('products_supplier_id_idx'),
      ('caja_movements_company_id_idx'), ('caja_movements_branch_id_idx'),
      ('caja_movements_created_by_idx')
    ) as esperados(nombre)
   where not exists (
     select 1 from pg_indexes
      where schemaname = 'public' and indexname = esperados.nombre
   );

  if v_faltan > 0 then
    raise exception 'Faltan % indices por crear', v_faltan;
  end if;
end
$comprobacion$;
