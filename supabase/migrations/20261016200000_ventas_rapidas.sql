-- Ventas rápidas: vender un artículo que no está en el catálogo (un "Varios"
-- con descripción, precio y, si el cajero quiere, costo) sin crear un producto.
--
-- La línea de venta (o de cotización) queda SIN producto y marcada
-- `is_quick = true`. La marca hace falta porque `product_id` nulo no basta para
-- reconocerlas: ya hay 3,029 líneas de `sale_items` con `product_id` nulo, todas
-- del legacy (productos que nunca se emparejaron). Con la marca explícita el
-- reporte, las sugerencias y el inventario distinguen una cosa de la otra, y
-- ninguna fila existente cambia: las líneas del legacy quedan en `false`.
--
-- Esta parte deja el esquema y los permisos:
--   1. Columnas `sale_items.is_quick`, `quote_items.is_quick` y `quote_items.cost`
--      (esta última para que una cotización convertida en venta conserve el costo
--      que puso el cajero).
--   2. `puede_vender_rapido(sucursal)`, gemela de `puede_editar_inventario`.
--   3. Permiso `quick-sales → create` para todo rol que ya puede vender (POS).
--   4. `seed_system_roles()` siembra ese permiso en las empresas nuevas.

-- ── Columnas ───────────────────────────────────────────────────────────────
alter table public.sale_items
  add column if not exists is_quick boolean not null default false;

alter table public.quote_items
  add column if not exists is_quick boolean not null default false;

-- Nulo = el cajero no puso costo (la ganancia de esa línea no se calcula).
alter table public.quote_items
  add column if not exists cost numeric;

comment on column public.sale_items.is_quick is
  'Venta rápida: artículo fuera del catálogo (sin product_id). No toca stock; su costo, si lo hay, es el que puso el cajero.';
comment on column public.quote_items.is_quick is
  'Línea de venta rápida: artículo fuera del catálogo (sin product_id). Al convertir la cotización pasa igual a la venta.';
comment on column public.quote_items.cost is
  'Costo que puso el cajero en una línea de venta rápida; nulo en las demás.';

-- ── Permiso ────────────────────────────────────────────────────────────────
-- Espejo en la base de usePermission('quick-sales', 'create') en la sucursal dada.
create or replace function public.puede_vender_rapido(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_company_admin() or exists (
    select 1
      from public.profile_branches pb
      join public.roles r on r.id = pb.role_id
     where pb.profile_id = auth.uid()
       and pb.branch_id = p_branch_id
       and pb.company_id = public.current_company_id()
       and coalesce(r.permissions -> 'quick-sales', '[]'::jsonb) ? 'create'
  );
$$;

comment on function public.puede_vender_rapido(uuid) is
  'Si el usuario puede hacer ventas rápidas en esa sucursal: admin de la empresa, o su rol en esa sucursal tiene quick-sales → create.';

revoke all on function public.puede_vender_rapido(uuid) from public;
revoke execute on function public.puede_vender_rapido(uuid) from anon;
grant execute on function public.puede_vender_rapido(uuid) to authenticated;

-- ── Roles existentes ───────────────────────────────────────────────────────
-- Todo rol que hoy puede vender en el POS recibe también la venta rápida (el
-- admin de la empresa puede quitársela después desde Roles). El `not … ? 'quick-sales'`
-- hace que volver a correr esto no pise lo que el admin haya cambiado.
update public.roles
   set permissions = permissions || '{"quick-sales": ["create"]}'::jsonb
 where coalesce(permissions -> 'pos', '[]'::jsonb) ? 'create'
   and not (permissions ? 'quick-sales');

-- ── Roles de las empresas nuevas ───────────────────────────────────────────
-- Igual que la definición viva (2026-10-16), sumando "quick-sales" al
-- Administrador y al Cajero.
create or replace function public.seed_system_roles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Seed roles
  insert into roles (company_id, name, key, is_system, description, permissions)
  values (
    NEW.id, 'Administrador', 'admin', true, 'Acceso completo a la empresa.',
    '{"dashboard":["view","create","edit","delete"],"pos":["view","create","edit","delete"],"sales":["view","create","edit","delete"],"quotes":["view","create","edit","delete"],"services":["view","create","edit","delete"],"credit":["view","create","edit","delete"],"financing":["view","create","edit","delete"],"prestamos":["view","create","edit","delete"],"caja":["view","create","edit","delete"],"expenses":["view","create","edit","delete"],"payables":["view","create","edit","delete"],"reports":["view","create","edit","delete"],"products":["view","create","edit","delete"],"customers":["view","create","edit","delete"],"suppliers":["view","create","edit","delete"],"company-profile":["view","create","edit","delete"],"users":["view","create","edit","delete"],"branches":["view","create","edit","delete"],"roles":["view","create","edit","delete"],"suscripcion":["view","create","edit","delete"],"service-types":["view","create","edit","delete"],"quick-sales":["create"]}'::jsonb
  )
  on conflict (company_id, key) where key is not null do nothing;

  insert into roles (company_id, name, key, is_system, description, permissions)
  values (
    NEW.id, 'Cajero', 'cashier', true, 'Acceso limitado para vender.',
    '{"dashboard":["view"],"pos":["view","create"],"quotes":["view","create"],"services":["view","create"],"caja":["view","create"],"quick-sales":["create"]}'::jsonb
  )
  on conflict (company_id, key) where key is not null do nothing;

  -- Seed default customer "Consumidor Final"
  if not exists (select 1 from public.customers where company_id = NEW.id and name = 'Consumidor Final') then
    insert into public.customers (company_id, name, ncf_type, discount_percentage, credit_balance)
    values (NEW.id, 'Consumidor Final', 'consumer'::ncf_type, 0, 0);
  end if;

  return NEW;
end;
$$;
