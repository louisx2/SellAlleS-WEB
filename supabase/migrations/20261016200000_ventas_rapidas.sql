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
-- Esta migración deja el esquema, los permisos y la venta:
--   1. Columnas `sale_items.is_quick`, `quote_items.is_quick` y `quote_items.cost`
--      (esta última para que una cotización convertida en venta conserve el costo
--      que puso el cajero).
--   2. `puede_vender_rapido(sucursal)`, gemela de `puede_editar_inventario`.
--   3. Permiso `quick-sales → create` para todo rol que ya puede vender (POS).
--   4. `seed_system_roles()` siembra ese permiso en las empresas nuevas.
--   5. `create_sale_with_items` acepta `is_quick` y `cost` por línea: valida el
--      módulo y el permiso, valida la línea y guarda el costo que puso el cajero.
--   6. `articulos_rapidos_recientes(sucursal)`: los artículos rápidos vendidos
--      en los últimos 90 días, para sugerirlos en el POS.

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

-- ── Venta: create_sale_with_items ──────────────────────────────────────────
-- Igual que la definición viva (2026-10-16, sin SECURITY DEFINER: la RLS de
-- sales/sale_items sigue protegiendo), sumando:
--   · cada línea puede traer `is_quick` y `cost`;
--   · si alguna línea es rápida, el módulo `quick-sales` debe estar activo en la
--     empresa y el rol del usuario en la sucursal debe permitirlo;
--   · una línea rápida no lleva producto, lleva descripción, precio >= 0,
--     cantidad > 0 y costo nulo o >= 0;
--   · el costo de una línea rápida es el que puso el cajero (nulo si no puso
--     ninguno); el de una línea de producto sigue siendo el del catálogo, sin
--     importar lo que mande el cliente.
-- La línea rápida no tiene product_id, así que el trigger de stock la deja pasar.
create or replace function public.create_sale_with_items(p_sale jsonb, p_items jsonb)
returns sales
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_tiene_rapidos boolean;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un artículo.';
  end if;

  insert into public.sales (
    branch_id, customer_id, subtotal, itbis_amount, total, itbis_included,
    payment_method, payment_status, amount_paid, payment_reference, ncf,
    ncf_type, ncf_requested, down_payment_method, down_payment_reference, notes,
    financing_details, user_name, user_email, quote_id, coupon_id
  ) values (
    nullif(p_sale->>'branch_id', '')::uuid,
    nullif(p_sale->>'customer_id', '')::uuid,
    coalesce((p_sale->>'subtotal')::numeric, 0),
    coalesce((p_sale->>'itbis_amount')::numeric, 0),
    coalesce((p_sale->>'total')::numeric, 0),
    coalesce((p_sale->>'itbis_included')::boolean, false),
    (p_sale->>'payment_method')::payment_method,
    (p_sale->>'payment_status')::payment_status,
    coalesce((p_sale->>'amount_paid')::numeric, 0),
    nullif(p_sale->>'payment_reference', ''), nullif(p_sale->>'ncf', ''),
    (p_sale->>'ncf_type')::ncf_type,
    coalesce((p_sale->>'ncf_requested')::boolean, false),
    nullif(p_sale->>'down_payment_method', ''),
    nullif(p_sale->>'down_payment_reference', ''), nullif(p_sale->>'notes', ''),
    p_sale->'financing_details', nullif(p_sale->>'user_name', ''),
    nullif(p_sale->>'user_email', ''), nullif(p_sale->>'quote_id', '')::uuid,
    nullif(p_sale->>'coupon_id', '')::uuid
  ) returning * into v_sale;

  select coalesce(bool_or(coalesce((x->>'is_quick')::boolean, false)), false)
    into v_tiene_rapidos
    from jsonb_array_elements(p_items) x;

  if v_tiene_rapidos then
    if not is_module_enabled(v_sale.company_id, 'quick-sales', true) then
      raise exception 'Las ventas rápidas están desactivadas para esta empresa.';
    end if;
    if not puede_vender_rapido(v_sale.branch_id) then
      raise exception 'Tu rol no permite ventas rápidas en esta sucursal.';
    end if;
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(
      product_id uuid, product_name text, quantity numeric, price numeric,
      custom_price numeric, itbis boolean, unit text, is_quick boolean, cost numeric
    )
  loop
    if coalesce(v_item.is_quick, false) then
      if v_item.product_id is not null then
        raise exception 'Un artículo rápido no puede llevar producto.';
      end if;
      if btrim(coalesce(v_item.product_name, '')) = '' then
        raise exception 'Escribe la descripción del artículo rápido.';
      end if;
      if v_item.price is null or v_item.price < 0 then
        raise exception 'El precio del artículo rápido no puede ser negativo.';
      end if;
      if v_item.quantity is null or v_item.quantity <= 0 then
        raise exception 'La cantidad vendida debe ser mayor que cero.';
      end if;
      if v_item.cost is not null and v_item.cost < 0 then
        raise exception 'El costo del artículo rápido no puede ser negativo.';
      end if;
    end if;

    insert into public.sale_items
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis, unit, cost, is_quick)
    values (
      v_sale.id, v_item.product_id,
      case when coalesce(v_item.is_quick, false) then btrim(v_item.product_name) else v_item.product_name end,
      v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false),
      coalesce(nullif(v_item.unit, ''), 'und'),
      case
        when coalesce(v_item.is_quick, false) then v_item.cost
        else (select p.cost from public.products p where p.id = v_item.product_id)
      end,
      coalesce(v_item.is_quick, false)
    );
  end loop;

  return v_sale;
end;
$function$;

-- ── Sugerencias: artículos rápidos recientes ───────────────────────────────
-- Una fila por descripción normalizada (minúsculas, espacios colapsados: la misma
-- regla que `normalizeQuickName` del front) con los datos de su venta más
-- reciente. Solo cuenta lo vendido en la sucursal en los últimos 90 días y no
-- anulado. SECURITY INVOKER: la RLS de sales/sale_items ya filtra por empresa.
create or replace function public.articulos_rapidos_recientes(
  p_branch_id uuid,
  p_limit int default 20
)
returns table (
  name text,
  price numeric,
  cost numeric,
  itbis boolean,
  last_sold_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select r.name, r.price, r.cost, r.itbis, r.last_sold_at
    from (
      select distinct on (lower(regexp_replace(btrim(si.product_name), '\s+', ' ', 'g')))
             btrim(si.product_name) as name,
             coalesce(si.custom_price, si.price) as price,
             si.cost as cost,
             si.itbis as itbis,
             s.created_at as last_sold_at
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
       where si.is_quick
         and s.branch_id = p_branch_id
         and s.cancelled_at is null
         and s.created_at >= now() - interval '90 days'
       order by lower(regexp_replace(btrim(si.product_name), '\s+', ' ', 'g')),
                s.created_at desc
    ) r
   order by r.last_sold_at desc, r.name
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.articulos_rapidos_recientes(uuid, int) is
  'Artículos rápidos vendidos en la sucursal en los últimos 90 días (sin anuladas): una fila por descripción normalizada, con precio y costo de la venta más reciente.';

revoke all on function public.articulos_rapidos_recientes(uuid, int) from public;
revoke execute on function public.articulos_rapidos_recientes(uuid, int) from anon;
grant execute on function public.articulos_rapidos_recientes(uuid, int) to authenticated;
