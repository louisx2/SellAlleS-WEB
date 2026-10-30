-- Presentaciones de producto: vender el mismo producto por unidad, paquete o
-- caja. El stock se cuenta siempre en la unidad base (`products.unit`); una
-- presentación solo dice cuántas unidades base trae y a qué precio se vende.
-- Diseño: docs/superpowers/specs/2026-10-29-presentaciones-design.md
--
-- Todo lo existente queda con `units_per = 1` y `presentation_id = null`, o sea
-- que se comporta exactamente igual que hoy: la app desplegada antes de esta
-- migración sigue vendiendo sin tocar nada.
--
-- PARTE 1 — esquema, validación y guardado (esta parte):
--   1. `products.sold_loose` ("se vende suelto").
--   2. Tabla `product_presentations`, su RLS (copia de `products_all`) y el
--      trigger `product_presentations_before_write`, que es el ÚNICO lugar donde
--      se valida (vale también para escrituras directas por PostgREST).
--   3. Columnas de presentación en las líneas de venta, cotización, compra y en
--      las transferencias (`presentation_id`, `presentation_name`, `units_per`).
--   4. `save_product_presentations` e `import_product_presentations`.
-- Las partes siguientes (venta y anulación, compras, transferencias) se agregan
-- al final de este mismo archivo.
--
-- Se prueba con supabase/tests/presentaciones.sql (ver su cabecera).

-- ── products.sold_loose ────────────────────────────────────────────────────
alter table public.products
  add column if not exists sold_loose boolean not null default true;

comment on column public.products.sold_loose is
  'Se vende suelto (por unidad base). Apagado: solo se vende por presentaciones y la base rechaza venderlo suelto.';

-- ── product_presentations ──────────────────────────────────────────────────
-- company_id y branch_id los copia el trigger desde products, así no pueden
-- divergir y la RLS es idéntica a la de products. SIN clave foránea a
-- companies/branches: no abrir caminos de embed ambiguos en PostgREST (incidente
-- branch_sharing, 2026-07-31).
create table if not exists public.product_presentations (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  company_id  uuid not null,
  branch_id   uuid not null,
  name        text not null check (btrim(name) <> ''),
  units       numeric(12,3) not null check (units > 1),
  price       numeric(12,2) not null check (price >= 0),
  code        text,
  created_at  timestamptz not null default now()
);

comment on table public.product_presentations is
  'Formas de vender un producto (paquete, caja, saco…). `units` = cuántas unidades base trae; el stock se cuenta siempre en la unidad base.';
comment on column public.product_presentations.company_id is
  'Copiado de products por el trigger; sin FK a propósito.';
comment on column public.product_presentations.branch_id is
  'Copiado de products por el trigger; sin FK a propósito.';

-- Un nombre por producto, sin distinguir mayúsculas ni espacios de los bordes.
create unique index if not exists product_presentations_product_name_key
  on public.product_presentations (product_id, lower(btrim(name)));

-- Búsqueda por código dentro de la sucursal (escaneo y validación de repetidos).
create index if not exists product_presentations_branch_code_idx
  on public.product_presentations (branch_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '';

alter table public.product_presentations enable row level security;

drop policy if exists product_presentations_all on public.product_presentations;
create policy product_presentations_all on public.product_presentations
  for all
  using (
    ((company_id = current_company_id())
      and (is_company_admin() or (branch_id in (select user_branch_ids() as user_branch_ids))))
    or is_super_admin()
  )
  with check (
    ((company_id = current_company_id())
      and (is_company_admin() or (branch_id in (select user_branch_ids() as user_branch_ids))))
    or is_super_admin()
  );

revoke all on public.product_presentations from anon;

-- ── Validación (único lugar) ───────────────────────────────────────────────
-- Corre ANTES de los checks de la tabla, así que los mensajes que ve el usuario
-- son estos. Los triggers no exigen EXECUTE a quien escribe; por eso la función
-- no se le concede a nadie (no es una RPC).
create or replace function public.product_presentations_before_write()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_product public.products%rowtype;
  v_owner text;
begin
  -- Visible para quien escribe (RLS): si no lo ve, es como si no existiera.
  select * into v_product from public.products where id = new.product_id;
  if not found then
    raise exception 'El producto no existe o no tienes acceso a él.';
  end if;

  new.company_id := v_product.company_id;
  new.branch_id := v_product.branch_id;
  new.name := btrim(new.name);
  new.code := nullif(btrim(new.code), '');

  if new.name is null or new.name = '' then
    raise exception 'La presentación necesita un nombre.';
  end if;

  if new.units is null or new.units <= 1 then
    raise exception 'Una presentación tiene que traer más de una unidad.';
  end if;

  -- Mismo criterio que src/lib/units.ts y transfer_products: solo las unidades
  -- medibles admiten fracciones; cualquier otra (o una desconocida) va entera.
  if v_product.unit not in ('lb','kg','g','oz','qq','m','pie','yd','plg','gal','l','ml')
     and new.units <> trunc(new.units) then
    raise exception '«%» se cuenta por piezas: la presentación tiene que traer una cantidad entera.', v_product.name;
  end if;

  if new.price is null or new.price < 0 then
    raise exception 'El precio de la presentación no puede ser negativo.';
  end if;

  if exists (select 1 from public.product_presentations x
              where x.product_id = new.product_id
                and x.id <> new.id
                and lower(btrim(x.name)) = lower(new.name)) then
    raise exception 'Ya hay una presentación llamada «%» en este producto.', new.name;
  end if;

  -- Un código no puede repetirse en la sucursal: ni con un producto activo (los
  -- archivados no cuentan; tampoco el del propio producto: el escaneo busca
  -- primero entre los códigos de producto y la presentación nunca saldría) ni
  -- con otra presentación, sin distinguir mayúsculas. En otra sucursal sí puede
  -- repetirse. El dueño que se nombra en el mensaje es el producto que ya lo usa.
  if new.code is not null then
    select p.name into v_owner
      from public.products p
     where p.branch_id = v_product.branch_id
       and p.is_active
       and p.code is not null
       and lower(btrim(p.code)) = lower(new.code)
     limit 1;

    if v_owner is null then
      select p.name into v_owner
        from public.product_presentations x
        join public.products p on p.id = x.product_id
       where x.branch_id = v_product.branch_id
         and x.id <> new.id
         and x.code is not null and btrim(x.code) <> ''
         and lower(btrim(x.code)) = lower(new.code)
       limit 1;
    end if;

    if v_owner is not null then
      raise exception 'El código «%» ya lo usa «%» en esta sucursal.', new.code, v_owner;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.product_presentations_before_write() from public, anon, authenticated;

drop trigger if exists product_presentations_before_write on public.product_presentations;
create trigger product_presentations_before_write
  before insert or update on public.product_presentations
  for each row execute function public.product_presentations_before_write();

-- ── Columnas de presentación en las líneas ─────────────────────────────────
-- Son copias, como `unit`: el recibo viejo se reimprime igual aunque cambie o
-- se borre la presentación (por eso on delete set null). `units_per` y
-- `presentation_name` los pone siempre el servidor, nunca el navegador.
alter table public.sale_items
  add column if not exists presentation_id uuid references public.product_presentations(id) on delete set null,
  add column if not exists presentation_name text,
  add column if not exists units_per numeric(12,3) not null default 1 check (units_per > 0);

alter table public.quote_items
  add column if not exists presentation_id uuid references public.product_presentations(id) on delete set null,
  add column if not exists presentation_name text,
  add column if not exists units_per numeric(12,3) not null default 1 check (units_per > 0);

alter table public.supplier_invoice_items
  add column if not exists presentation_id uuid references public.product_presentations(id) on delete set null,
  add column if not exists presentation_name text,
  add column if not exists units_per numeric(12,3) not null default 1 check (units_per > 0);

-- `quantity` pasa a ser en la presentación; stock movido = quantity × units_per.
alter table public.product_transfers
  add column if not exists presentation_name text,
  add column if not exists units_per numeric(12,3) not null default 1 check (units_per > 0);

-- Borrar una presentación hace `set null` en estas tablas: sin índice sería un
-- recorrido completo de sale_items (~20 mil filas) en cada borrado.
create index if not exists sale_items_presentation_id_idx
  on public.sale_items (presentation_id) where presentation_id is not null;
create index if not exists quote_items_presentation_id_idx
  on public.quote_items (presentation_id) where presentation_id is not null;
create index if not exists supplier_invoice_items_presentation_id_idx
  on public.supplier_invoice_items (presentation_id) where presentation_id is not null;

comment on column public.sale_items.presentation_id is
  'Presentación vendida; nulo si fue suelta o si la presentación se borró después.';
comment on column public.sale_items.presentation_name is
  'Copia del nombre de la presentación al vender (nulo en ventas sueltas).';
comment on column public.sale_items.units_per is
  'Copia de las unidades base por presentación al vender (1 en ventas sueltas). Stock movido = quantity × units_per.';
comment on column public.quote_items.units_per is
  'Unidades base por presentación en la cotización (1 si es suelta).';
comment on column public.supplier_invoice_items.units_per is
  'Unidades base por presentación en la compra (1 si es suelta). Stock sumado = quantity × units_per.';
comment on column public.product_transfers.units_per is
  'Unidades base por presentación enviada (1 si es suelta). Stock movido = quantity × units_per.';

-- ── save_product_presentations ─────────────────────────────────────────────
-- Escribe las presentaciones y `products.sold_loose` en la misma transacción,
-- para que un producto nunca quede "no se vende suelto" sin presentaciones.
-- Diferencia en vez de borrar y reinsertar, en este orden: borra las que faltan,
-- actualiza las que traen `id` e inserta las que no (así reusar el nombre de una
-- que se quita no choca consigo misma). El envío es el estado completo
-- deseado: un `code` ausente deja la presentación sin código.
-- p_items: [{id?, name, units, price, code?}]. SECURITY INVOKER: aplica la RLS.
create or replace function public.save_product_presentations(
  p_product_id uuid,
  p_sold_loose boolean,
  p_items jsonb
)
returns setof public.product_presentations
language plpgsql
set search_path to 'public'
as $function$
declare
  v_product public.products%rowtype;
  v_item record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Las presentaciones tienen que venir como una lista de objetos.';
  end if;

  -- Se bloquea el producto: dos guardados a la vez se esperan en vez de pisarse.
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'El producto no existe o no tienes acceso a él.';
  end if;

  delete from public.product_presentations pp
   where pp.product_id = p_product_id
     and not exists (select 1 from jsonb_array_elements(p_items) e
                      where nullif(e->>'id', '')::uuid = pp.id);

  for v_item in
    select nullif(e.v->>'id', '')::uuid as id,
           e.v->>'name' as name,
           (e.v->>'units')::numeric as units,
           (e.v->>'price')::numeric as price,
           e.v->>'code' as code
      from jsonb_array_elements(p_items) with ordinality as e(v, ord)
     where nullif(e.v->>'id', '') is not null
     order by e.ord
  loop
    update public.product_presentations
       set name = v_item.name, units = v_item.units, price = v_item.price, code = v_item.code
     where id = v_item.id and product_id = p_product_id;
    if not found then
      raise exception 'La presentación no corresponde a este producto.';
    end if;
  end loop;

  insert into public.product_presentations (product_id, name, units, price, code)
  select p_product_id,
         e.v->>'name',
         (e.v->>'units')::numeric,
         (e.v->>'price')::numeric,
         e.v->>'code'
    from jsonb_array_elements(p_items) with ordinality as e(v, ord)
   where nullif(e.v->>'id', '') is null
   order by e.ord;

  -- Este update además dispara el realtime de `products` en las otras pantallas.
  update public.products
     set sold_loose = coalesce(p_sold_loose, sold_loose)
   where id = p_product_id;

  if not (select sold_loose from public.products where id = p_product_id)
     and not exists (select 1 from public.product_presentations where product_id = p_product_id) then
    raise exception 'Si «%» no se vende suelto, necesita al menos una presentación.', v_product.name;
  end if;

  return query
    select pp.* from public.product_presentations pp
     where pp.product_id = p_product_id
     order by pp.units, pp.created_at, pp.id;
end;
$function$;

revoke all on function public.save_product_presentations(uuid, boolean, jsonb) from public;
revoke execute on function public.save_product_presentations(uuid, boolean, jsonb) from anon;
grant execute on function public.save_product_presentations(uuid, boolean, jsonb) to authenticated;

-- ── import_product_presentations ───────────────────────────────────────────
-- Para el CSV, en lote. Por cada producto: empareja cada presentación por
-- (product_id, lower(btrim(name))), actualiza o inserta, y NUNCA borra. La clave
-- `code` solo cambia el código si viene en la fila (vacía o nula lo limpia);
-- `sold_loose` ausente deja el valor actual. Devuelve cuántas presentaciones
-- escribió. Una fila mala deshace todo el lote.
-- p_rows: [{product_id, sold_loose?, presentations: [{name, units, price, code?}]}].
-- SECURITY INVOKER: aplica la RLS.
create or replace function public.import_product_presentations(p_rows jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row record;
  v_pres record;
  v_product public.products%rowtype;
  v_existing uuid;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas de presentaciones tienen que venir como una lista.';
  end if;

  for v_row in
    select e.v as v from jsonb_array_elements(p_rows) with ordinality as e(v, ord) order by e.ord
  loop
    select * into v_product from public.products
     where id = nullif(v_row.v->>'product_id', '')::uuid for update;
    if not found then
      raise exception 'El producto no existe o no tienes acceso a él.';
    end if;

    for v_pres in
      select e.v as v
        from jsonb_array_elements(coalesce(v_row.v->'presentations', '[]'::jsonb)) with ordinality as e(v, ord)
       order by e.ord
    loop
      select pp.id into v_existing
        from public.product_presentations pp
       where pp.product_id = v_product.id
         and lower(btrim(pp.name)) = lower(btrim(v_pres.v->>'name'))
       limit 1;

      if v_existing is null then
        insert into public.product_presentations (product_id, name, units, price, code)
        values (v_product.id, v_pres.v->>'name', (v_pres.v->>'units')::numeric,
                (v_pres.v->>'price')::numeric, v_pres.v->>'code');
      elsif v_pres.v ? 'code' then
        update public.product_presentations
           set name = v_pres.v->>'name', units = (v_pres.v->>'units')::numeric,
               price = (v_pres.v->>'price')::numeric, code = v_pres.v->>'code'
         where id = v_existing;
      else
        update public.product_presentations
           set name = v_pres.v->>'name', units = (v_pres.v->>'units')::numeric,
               price = (v_pres.v->>'price')::numeric
         where id = v_existing;
      end if;

      v_count := v_count + 1;
    end loop;

    update public.products
       set sold_loose = coalesce((v_row.v->>'sold_loose')::boolean, sold_loose)
     where id = v_product.id;

    if not (select sold_loose from public.products where id = v_product.id)
       and not exists (select 1 from public.product_presentations where product_id = v_product.id) then
      raise exception 'Si «%» no se vende suelto, necesita al menos una presentación.', v_product.name;
    end if;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.import_product_presentations(jsonb) from public;
revoke execute on function public.import_product_presentations(jsonb) from anon;
grant execute on function public.import_product_presentations(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — venta y anulación por presentación (base)
-- ════════════════════════════════════════════════════════════════════════════
-- El stock se cuenta en unidad base: una línea de `quantity` presentaciones de
-- `units_per` unidades mueve `quantity × units_per`. Las tres funciones se
-- reescriben desde su definición viva (`pg_get_functiondef` del 2026-10-29), no
-- desde el repo, y solo cambia lo siguiente:
--   · create_sale_with_items: lee `presentation_id` por línea y busca la
--     presentación en el servidor, comprobando que sea del mismo producto
--     (`units_per` y `presentation_name` del navegador se ignoran); con
--     presentación exige cantidad entera; sin ella, rechaza el producto que ya
--     no se vende suelto; un artículo rápido no admite presentación; el costo
--     de la línea es `products.cost × units_per`. Se conservan los casts a
--     payment_method / payment_status / ncf_type (son ENUM) y toda la lógica de
--     is_quick, módulos y permisos.
--   · decrement_product_stock_for_sale_item: descuenta y compara
--     `quantity × units_per`. Cada línea actúa sobre lo que dejaron las
--     anteriores de la misma venta, así que el stock se valida contra la suma.
--   · annul_sale: repone `quantity × units_per`, los de la línea (la
--     presentación pudo cambiar o borrarse después de vender).
-- Son CREATE OR REPLACE con la misma firma: conservan dueño y permisos.
-- Lo existente tiene `units_per = 1`, así que se comporta igual que antes.

CREATE OR REPLACE FUNCTION public.create_sale_with_items(p_sale jsonb, p_items jsonb)
 RETURNS sales
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_item record;
  v_tiene_rapidos boolean;
  v_units_per numeric;
  v_pres_id uuid;
  v_pres_name text;
  v_nombre text;
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
      custom_price numeric, itbis boolean, unit text, is_quick boolean, cost numeric,
      presentation_id uuid
    )
  loop
    -- Lo que la línea mueva del inventario lo decide el servidor: nombre y
    -- unidades de la presentación salen de su fila, nunca del navegador. Sin
    -- presentación la línea es suelta (1 unidad base).
    v_units_per := 1;
    v_pres_id := null;
    v_pres_name := null;

    if coalesce(v_item.is_quick, false) then
      if v_item.product_id is not null then
        raise exception 'Un artículo rápido no puede llevar producto.';
      end if;
      if v_item.presentation_id is not null then
        raise exception 'Un artículo rápido no puede llevar presentación.';
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
    elsif v_item.presentation_id is not null then
      -- Se busca por id y tiene que ser de este producto (la RLS de
      -- product_presentations deja fuera las de otras empresas y sucursales).
      select pp.id, pp.name, pp.units
        into v_pres_id, v_pres_name, v_units_per
        from public.product_presentations pp
       where pp.id = v_item.presentation_id and pp.product_id = v_item.product_id;
      if not found then
        raise exception 'La presentación no corresponde a este producto.';
      end if;
      if v_item.quantity <> trunc(v_item.quantity) then
        raise exception 'Las presentaciones van enteras: la cantidad tiene que ser un número entero.';
      end if;
    elsif v_item.product_id is not null then
      select p.name into v_nombre
        from public.products p
       where p.id = v_item.product_id and not p.sold_loose;
      if found then
        raise exception '«%» no se vende suelto.', v_nombre;
      end if;
    end if;

    insert into public.sale_items
      (sale_id, product_id, product_name, quantity, price, custom_price, itbis, unit, cost, is_quick,
       presentation_id, presentation_name, units_per)
    values (
      v_sale.id, v_item.product_id,
      case when coalesce(v_item.is_quick, false) then btrim(v_item.product_name) else v_item.product_name end,
      v_item.quantity,
      v_item.price, v_item.custom_price, coalesce(v_item.itbis, false),
      coalesce(nullif(v_item.unit, ''), 'und'),
      case
        when coalesce(v_item.is_quick, false) then v_item.cost
        else (select p.cost from public.products p where p.id = v_item.product_id) * v_units_per
      end,
      coalesce(v_item.is_quick, false),
      v_pres_id, v_pres_name, v_units_per
    );
  end loop;

  return v_sale;
end;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_product_stock_for_sale_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'La cantidad vendida debe ser mayor que cero.';
  end if;

  v_company := current_company_id();

  if not coalesce((
    select tracks_stock from public.products
     where id = new.product_id and company_id = v_company
  ), true) then
    return new;
  end if;

  -- El stock se cuenta en unidad base: una línea de presentación descuenta
  -- quantity × units_per (units_per es 1 en las sueltas). Cada línea descuenta
  -- y compara contra lo que dejaron las anteriores de la misma venta, así que
  -- el mismo producto en dos líneas se valida contra la suma.
  update public.products
     set stock = stock - new.quantity * new.units_per
   where id = new.product_id
     and company_id = v_company
     and stock >= new.quantity * new.units_per;

  if not found then
    if exists (
      select 1 from public.products
       where id = new.product_id and company_id = v_company
    ) then
      raise exception 'Stock insuficiente para completar la venta.';
    end if;
    raise exception 'El producto seleccionado no pertenece a esta empresa.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.annul_sale(p_sale_id uuid, p_reason text DEFAULT NULL::text, p_refund_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale          sales%rowtype;
  v_seq           ncf_sequences%rowtype;
  v_session       caja_sessions%rowtype;
  v_item          record;
  v_pay           credit_payments%rowtype;
  v_ncf           text := null;
  v_user_name     text;
  v_note_id       uuid;
  v_refund_method text;
  v_is_credit     boolean;
  v_down_paid     numeric := 0;
  v_down_method   text;
  v_voided        numeric := 0;
  v_cash_out      numeric := 0;
  v_void_reason   text;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or (v_sale.company_id <> current_company_id() and not is_super_admin()) then
    raise exception 'Venta no encontrada.';
  end if;

  -- La función es SECURITY DEFINER (salta RLS para tomar la secuencia B04 y
  -- escribir credit_notes), así que el permiso se valida aquí. V1: solo
  -- administradores de la empresa; los roles personalizados con sales:delete
  -- ven el botón pero la base los rechaza (pendiente de unificar).
  if not (is_company_admin() or is_super_admin()) then
    raise exception 'Solo un administrador puede anular ventas.';
  end if;

  if v_sale.cancelled_at is not null then
    raise exception 'Esta venta ya fue anulada.';
  end if;

  v_is_credit := v_sale.payment_status in ('credit', 'in_financing');

  if v_is_credit then
    select coalesce(sum(amount), 0), min(method::text)
      into v_down_paid, v_down_method
      from credit_payments
     where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null;

    -- Abonos posteriores todavía vigentes: los que nombran la venta, los
    -- generales cuyo reparto la tocó y, para los viejos sin reparto
    -- registrado, lo que `amount_paid` tenga por encima del abono inicial.
    if exists (
         select 1 from credit_payments cp
          where cp.voided_at is null
            and cp.kind <> 'down_payment'
            and (cp.sale_id = v_sale.id
                 or exists (select 1
                              from jsonb_array_elements(coalesce(cp.allocation->'sales', '[]'::jsonb)) e
                             where e->>'sale_id' = v_sale.id::text))
       )
       or v_sale.amount_paid > v_down_paid + 0.01 then
      raise exception 'Esta venta tiene abonos posteriores al abono inicial. Anúlalos primero desde el detalle de la venta (o el estado de cuenta del cliente) y luego anula la venta.';
    end if;

    -- Sin abono inicial no hay nada que devolver.
    v_refund_method := case
      when p_refund_method = 'none' or v_down_paid <= 0 then 'none'
      else v_down_method
    end;
    if p_refund_method is not null and p_refund_method not in ('none', v_refund_method) then
      raise exception 'El abono inicial entró por %: la devolución sale por esa misma vía, o elige "Sin devolución".',
        case v_down_method when 'cash' then 'efectivo' when 'card' then 'tarjeta' else 'transferencia' end;
    end if;
  else
    -- payment_method es un enum en la base: se compara/almacena como texto aquí.
    -- Sin método explícito se asume que el dinero vuelve por donde entró; 'none'
    -- hay que pedirlo a propósito, para que no se anule sin devolver por descuido.
    v_refund_method := coalesce(p_refund_method, v_sale.payment_method::text);
  end if;

  if v_refund_method not in ('cash', 'card', 'transfer', 'none') then
    raise exception 'Método de devolución no válido.';
  end if;

  -- NCF B04: solo si la venta original llevó comprobante. Una venta facturada
  -- por error igual consumió su NCF, así que la nota de crédito se emite
  -- aunque no haya devolución: es lo que la deja anulada ante la DGII.
  if v_sale.ncf is not null then
    select * into v_seq from ncf_sequences
     where company_id = v_sale.company_id
       and tipo = 'nota_credito'
       and active
       and (expires_at is null or expires_at >= company_today(v_sale.company_id))
       and current_val <= range_to
     order by created_at
     limit 1
     for update;
    if not found then
      raise exception 'No hay una secuencia de Notas de Crédito (B04) activa con números disponibles. Agrégala en Perfil de Sucursal → Facturación Fiscal.';
    end if;
    v_ncf := v_seq.prefix || lpad(v_seq.current_val::text, 8, '0');
    update ncf_sequences set current_val = current_val + 1 where id = v_seq.id;
  end if;

  -- La devolución en efectivo sale de la caja: si el módulo está activo,
  -- exige caja abierta (mismo criterio que los pagos a suplidores). Sin
  -- devolución no hay salida de dinero, así que la caja no hace falta.
  if v_refund_method = 'cash' and caja_blocks_cash(v_sale.company_id, v_sale.branch_id) then
    raise exception 'No hay una caja abierta en esta sucursal. Abre caja antes de devolver efectivo.';
  end if;

  -- Reponer inventario de las líneas con producto. Los productos que no
  -- manejan existencias quedan fuera: nunca se les descontó nada al vender.
  -- Se repone en unidad base (quantity × units_per, los de la línea: la
  -- presentación pudo haberse editado o borrado después de vender).
  for v_item in
    select si.product_id, si.quantity * si.units_per as base_qty
      from sale_items si
      join products p on p.id = si.product_id and p.company_id = v_sale.company_id
     where si.sale_id = v_sale.id
       and si.product_id is not null
       and p.tracks_stock
  loop
    update products set stock = stock + v_item.base_qty
     where id = v_item.product_id and company_id = v_sale.company_id;
  end loop;

  select name into v_user_name from profiles where id = auth.uid();

  if v_is_credit then
    v_void_reason := 'Venta anulada' || coalesce(': ' || nullif(btrim(p_reason), ''), '');

    if v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
      select * into v_session from caja_sessions
       where branch_id = v_sale.branch_id and status = 'open' for update;
    end if;

    for v_pay in
      select * from credit_payments
       where sale_id = v_sale.id and kind = 'down_payment' and voided_at is null
       for update
    loop
      update credit_payments
         set voided_at = now(), voided_by = auth.uid(),
             voided_by_name = v_user_name, void_reason = v_void_reason
       where id = v_pay.id;
      v_voided := v_voided + v_pay.amount;

      -- Cobrado en la sesión que sigue abierta: basta con anularlo, el cierre
      -- ya no lo cuenta. Cobrado en una sesión que ya cerró con ese dinero
      -- contado: hay que sacarlo de la caja abierta ahora.
      if v_refund_method = 'cash' and v_pay.method = 'cash'
         and v_session.id is not null and v_session.opened_at > v_pay.date then
        v_cash_out := v_cash_out + v_pay.amount;
      end if;
    end loop;

    update sales set amount_paid = greatest(round(amount_paid - v_voided, 2), 0)
     where id = v_sale.id;
  end if;

  insert into credit_notes
    (company_id, branch_id, sale_id, customer_id, ncf, ncf_modified,
     subtotal, itbis_amount, total, refund_method, reason, user_id, user_name)
  values
    (v_sale.company_id, v_sale.branch_id, v_sale.id, v_sale.customer_id,
     v_ncf, v_sale.ncf, v_sale.subtotal, v_sale.itbis_amount, v_sale.total,
     v_refund_method, nullif(p_reason, ''), auth.uid(), v_user_name)
  returning id into v_note_id;

  update sales set cancelled_at = now() where id = v_sale.id;

  if v_is_credit then
    if v_cash_out > 0 then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_cash_out,
         'Devolución del abono inicial por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
    perform recompute_customer_balance(v_sale.customer_id);
  elsif v_refund_method = 'cash' and is_module_enabled(v_sale.company_id, 'caja', false) then
    select * into v_session from caja_sessions
     where branch_id = v_sale.branch_id and status = 'open' for update;
    if found then
      insert into caja_movements
        (session_id, company_id, branch_id, type, amount, reason, created_by, created_by_name)
      values
        (v_session.id, v_sale.company_id, v_sale.branch_id, 'out', v_sale.total,
         'Devolución por anulación de venta'
           || case when v_ncf is not null then ' · NC ' || v_ncf else '' end,
         auth.uid(), v_user_name);
    end if;
  end if;

  return jsonb_build_object(
    'credit_note_id', v_note_id,
    'ncf',            v_ncf,
    'ncf_modified',   v_sale.ncf,
    'total',          v_sale.total,
    'refund_method',  v_refund_method,
    'payments_voided', v_voided
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — compras y transferencias entre sucursales por presentación (base)
-- ════════════════════════════════════════════════════════════════════════════
-- Igual que en la venta, el stock se cuenta en unidad base: una línea de
-- `quantity` presentaciones de `units_per` unidades mueve `quantity × units_per`.
-- Las dos funciones se reescriben desde su definición viva (`pg_get_functiondef` del
-- 2026-10-29: md5 a9abd60a6e8d1304c46ab154d91f9338 y
-- 01f96cd3d6d045c33be98257189f2cda), no desde el repo, y solo cambia lo
-- siguiente:
--   · create_supplier_invoice: cada ítem acepta `presentation_id`; se busca en el
--     servidor y tiene que ser del mismo producto (`units_per` y
--     `presentation_name` del navegador se ignoran); con presentación exige
--     cantidad entera; guarda las tres columnas en la línea y suma
--     `quantity × units_per` al stock, con las mismas condiciones de hoy (módulo
--     `purchases` encendido y `tracks_stock`). `unit_cost` sigue siendo por
--     presentación y no toca `products.cost`.
--   · transfer_products: cada ítem acepta `presentation_id`; las líneas se
--     agrupan por (producto, presentación) en orden de producto. Cada vuelta
--     resuelve `units_per` (1 sin presentación), exige cantidad entera si hay
--     presentación y compara, descuenta y suma `quantity × units_per` (también
--     para decidir si se archiva el origen), sobre lo que dejaron las líneas
--     anteriores del mismo producto: el stock se valida contra la suma.
--     `product_transfers.quantity` queda en la presentación y se guardan
--     `presentation_name`, `units_per` y `unit_cost = products.cost × units_per`.
--     Cuando la transferencia CREA el producto en el destino, copia todas sus
--     presentaciones; la copia queda sin código si allá ya lo usa un producto
--     activo u otra presentación (se comprueba antes de insertar, con el
--     criterio del trigger). Si el producto ya existía, no toca las suyas.
-- Siguen igual el modo de seguridad (create_supplier_invoice, invoker;
-- transfer_products, definer), el search_path, los permisos, el candado del
-- número de conduce, el archivado al vaciar y el manejo de ubicación y categoría.
-- Son CREATE OR REPLACE con la misma firma: conservan dueño y permisos.

CREATE OR REPLACE FUNCTION public.create_supplier_invoice(p_supplier_id uuid, p_issue_date date, p_branch_id uuid DEFAULT NULL::uuid, p_invoice_number text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_subtotal_goods numeric DEFAULT 0, p_subtotal_services numeric DEFAULT 0, p_ncf text DEFAULT NULL::text, p_ncf_modified text DEFAULT NULL::text, p_expense_type text DEFAULT NULL::text, p_itbis_facturado numeric DEFAULT 0, p_itbis_retenido numeric DEFAULT 0, p_itbis_proporcionalidad numeric DEFAULT 0, p_itbis_llevado_costo numeric DEFAULT 0, p_isr_retention_type text DEFAULT NULL::text, p_isr_retention_amount numeric DEFAULT 0, p_impuesto_selectivo numeric DEFAULT 0, p_otros_impuestos numeric DEFAULT 0, p_propina_legal numeric DEFAULT 0, p_payment_form text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_initial_payment numeric DEFAULT 0, p_initial_method text DEFAULT 'cash'::text, p_initial_reference text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company      uuid;
  v_goods        numeric := coalesce(p_subtotal_goods, 0);
  v_services     numeric := coalesce(p_subtotal_services, 0);
  v_ncf          text    := nullif(trim(coalesce(p_ncf, '')), '');
  v_total        numeric;
  v_invoice      supplier_invoices%rowtype;
  v_item         record;
  v_desc         text;
  v_user_name    text;
  v_purchases_on boolean;
  v_pay          jsonb;
  v_units_per    numeric;
  v_pres_id      uuid;
  v_pres_name    text;
begin
  v_company := current_company_id();

  if not exists (select 1 from suppliers where id = p_supplier_id and company_id = v_company) then
    raise exception 'Suplidor no encontrado.';
  end if;
  if p_issue_date is null then
    raise exception 'La fecha del comprobante es obligatoria.';
  end if;
  if v_goods + v_services <= 0 then
    raise exception 'El monto facturado debe ser mayor que cero.';
  end if;
  if v_ncf is not null and upper(v_ncf) !~ '^[BE][0-9]{10,12}$' then
    raise exception 'El NCF no tiene un formato válido (ej. B0100000001).';
  end if;
  if v_ncf is not null and p_expense_type is null then
    raise exception 'Con NCF, el tipo de gasto (Formato 606) es obligatorio.';
  end if;
  if v_ncf is not null and exists (
    select 1 from supplier_invoices
     where company_id = v_company and supplier_id = p_supplier_id and ncf = upper(v_ncf)
  ) then
    raise exception 'Ya existe una factura con ese NCF para este suplidor.';
  end if;

  v_total := v_goods + v_services
           + coalesce(p_itbis_facturado, 0) + coalesce(p_impuesto_selectivo, 0)
           + coalesce(p_otros_impuestos, 0) + coalesce(p_propina_legal, 0);

  if coalesce(p_itbis_retenido, 0) + coalesce(p_isr_retention_amount, 0) > v_total then
    raise exception 'Las retenciones no pueden exceder el total de la factura.';
  end if;

  select name into v_user_name from profiles where id = auth.uid();

  insert into supplier_invoices (
    company_id, branch_id, supplier_id, invoice_number, issue_date, due_date,
    subtotal_goods, subtotal_services, total,
    ncf, ncf_modified, expense_type,
    itbis_facturado, itbis_retenido, itbis_proporcionalidad, itbis_llevado_costo,
    isr_retention_type, isr_retention_amount,
    impuesto_selectivo, otros_impuestos, propina_legal,
    payment_form, notes, user_id, user_name
  ) values (
    v_company, p_branch_id, p_supplier_id, nullif(trim(coalesce(p_invoice_number, '')), ''),
    p_issue_date, p_due_date,
    v_goods, v_services, v_total,
    upper(v_ncf), nullif(trim(coalesce(p_ncf_modified, '')), ''), p_expense_type,
    coalesce(p_itbis_facturado, 0), coalesce(p_itbis_retenido, 0),
    coalesce(p_itbis_proporcionalidad, 0), coalesce(p_itbis_llevado_costo, 0),
    p_isr_retention_type, coalesce(p_isr_retention_amount, 0),
    coalesce(p_impuesto_selectivo, 0), coalesce(p_otros_impuestos, 0), coalesce(p_propina_legal, 0),
    p_payment_form, p_notes, auth.uid(), v_user_name
  ) returning * into v_invoice;

  v_purchases_on := is_module_enabled(v_company, 'purchases', false);

  for v_item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(product_id uuid, description text, quantity numeric, unit_cost numeric, itbis_amount numeric,
           presentation_id uuid)
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'La cantidad de cada línea debe ser mayor que cero.';
    end if;
    if coalesce(v_item.unit_cost, -1) < 0 then
      raise exception 'El costo unitario de cada línea no puede ser negativo.';
    end if;

    -- Lo que la línea sume al inventario lo decide el servidor: nombre y
    -- unidades salen de la fila de la presentación, nunca del navegador. Sin
    -- presentación la línea es suelta (1 unidad base). `unit_cost` es por
    -- presentación.
    v_units_per := 1;
    v_pres_id := null;
    v_pres_name := null;
    if v_item.presentation_id is not null then
      select pp.id, pp.name, pp.units
        into v_pres_id, v_pres_name, v_units_per
        from product_presentations pp
       where pp.id = v_item.presentation_id and pp.product_id = v_item.product_id;
      if not found then
        raise exception 'La presentación no corresponde a este producto.';
      end if;
      if v_item.quantity <> trunc(v_item.quantity) then
        raise exception 'Las presentaciones van enteras: la cantidad tiene que ser un número entero.';
      end if;
    end if;

    v_desc := nullif(trim(coalesce(v_item.description, '')), '');
    if v_desc is null and v_item.product_id is not null then
      select name into v_desc from products where id = v_item.product_id and company_id = v_company;
    end if;
    if v_desc is null then
      raise exception 'Cada línea debe tener una descripción.';
    end if;

    insert into supplier_invoice_items
      (company_id, invoice_id, product_id, description, quantity, unit_cost, itbis_amount,
       presentation_id, presentation_name, units_per)
    values
      (v_company, v_invoice.id, v_item.product_id, v_desc,
       v_item.quantity, v_item.unit_cost, coalesce(v_item.itbis_amount, 0),
       v_pres_id, v_pres_name, v_units_per);

    if v_purchases_on and v_item.product_id is not null then
      if not exists (
        select 1 from products where id = v_item.product_id and company_id = v_company
      ) then
        raise exception 'Producto no encontrado para esta empresa.';
      end if;
      update products set stock = stock + v_item.quantity * v_units_per
       where id = v_item.product_id and company_id = v_company and tracks_stock;
    end if;
  end loop;

  if coalesce(p_initial_payment, 0) > 0 then
    v_pay := register_supplier_payment(
      v_invoice.id, p_initial_payment, coalesce(p_initial_method, 'cash'),
      p_branch_id, 'Pago inicial', p_initial_reference);
    select * into v_invoice from supplier_invoices where id = v_invoice.id;
  end if;

  return jsonb_build_object(
    'invoice_id',      v_invoice.id,
    'total',           v_invoice.total,
    'status',          v_invoice.status,
    'balance',         v_invoice.balance,
    'initial_payment', v_pay
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_products(p_from_branch_id uuid, p_to_branch_id uuid, p_items jsonb, p_target_location_id uuid DEFAULT NULL::uuid, p_archive_empty boolean DEFAULT true, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_company uuid;
    v_to_company uuid;
    v_to_active boolean;
    v_batch_id uuid;
    v_number integer;
    v_item record;
    v_source public.products%rowtype;
    v_target_product_id uuid;
    v_target_active boolean;
    v_target_category_id uuid;
    v_created boolean;
    v_reactivated boolean;
    v_archived boolean;
    v_count integer := 0;
    v_units_per numeric;
    v_pres_name text;
    v_base_qty numeric;
    v_copy record;
    v_copy_code text;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'El envío no tiene artículos.';
    end if;

    if jsonb_array_length(p_items) > 300 then
        raise exception 'Un envío admite hasta 300 artículos. Divídelo en varios.';
    end if;

    select company_id into v_company from public.branches where id = p_from_branch_id;
    if v_company is null then
        raise exception 'La sucursal que envía no existe.';
    end if;

    if not (v_company = public.current_company_id() or public.is_super_admin()) then
        raise exception 'No tienes permiso para mover inventario de esta empresa.';
    end if;

    if not public.puede_editar_inventario(p_from_branch_id) then
        raise exception 'No tienes permiso para transferir desde esta sucursal: hace falta poder editar su inventario.';
    end if;

    select company_id, is_active into v_to_company, v_to_active
      from public.branches where id = p_to_branch_id;
    if v_to_company is distinct from v_company then
        raise exception 'La sucursal destino no es válida.';
    end if;
    if not coalesce(v_to_active, true) then
        raise exception 'La sucursal destino está desactivada.';
    end if;

    if p_to_branch_id = p_from_branch_id then
        raise exception 'La sucursal destino tiene que ser distinta de la de origen.';
    end if;

    if p_target_location_id is not null and not exists (
      select 1 from public.product_locations
       where id = p_target_location_id and branch_id = p_to_branch_id) then
        raise exception 'La ubicación elegida no es de la sucursal destino.';
    end if;

    -- Número del conduce. El candado por empresa hace que dos envíos a la vez
    -- esperen uno por el otro en vez de sacar el mismo número; se suelta con la
    -- transacción. Los envíos no se borran (solo con la empresa entera), así
    -- que max + 1 no repite números.
    perform pg_advisory_xact_lock(hashtext('product_transfer_batches:' || v_company::text));
    select coalesce(max(number), 0) + 1 into v_number
      from public.product_transfer_batches where company_id = v_company;

    insert into public.product_transfer_batches
        (company_id, number, from_branch_id, to_branch_id, notes, created_by, created_by_name)
    values
        (v_company, v_number, p_from_branch_id, p_to_branch_id, nullif(btrim(p_notes), ''), auth.uid(),
         (select name from public.profiles where id = auth.uid()))
    returning id into v_batch_id;

    -- Un mismo artículo (y presentación) dos veces en la lista se suma en una
    -- línea. Se recorren en orden de id para que dos envíos simultáneos bloqueen
    -- las filas en el mismo orden y no se traben entre sí. El mismo producto en
    -- varias líneas (suelto y por presentaciones) se valida contra la suma: cada
    -- vuelta compara y descuenta sobre lo que dejaron las anteriores.
    for v_item in
        select x.product_id, x.presentation_id, sum(x.quantity) as quantity
          from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, presentation_id uuid)
         group by x.product_id, x.presentation_id
         order by x.product_id, x.presentation_id
    loop
        if v_item.product_id is null then
            raise exception 'Hay un artículo sin identificar en el envío.';
        end if;

        select * into v_source from public.products
         where id = v_item.product_id and branch_id = p_from_branch_id
           for update;
        if not found then
            raise exception 'Un artículo del envío no está en la sucursal que envía.';
        end if;

        if not v_source.is_active then
            raise exception '«%» está archivado; restáuralo antes de enviarlo.', v_source.name;
        end if;

        if not v_source.tracks_stock then
            raise exception '«%» no lleva inventario, no hay existencias que enviar.', v_source.name;
        end if;

        if v_item.quantity is null or v_item.quantity <= 0 then
            raise exception 'La cantidad de «%» debe ser mayor que cero.', v_source.name;
        end if;

        -- `quantity` es en la presentación (1 si es suelta); el inventario se
        -- mueve siempre en unidad base: quantity × units_per. Las unidades y el
        -- nombre salen de la fila de la presentación, que tiene que ser de este
        -- producto (la función salta la RLS, así que se comprueba aquí).
        v_units_per := 1;
        v_pres_name := null;
        if v_item.presentation_id is not null then
            select pp.name, pp.units into v_pres_name, v_units_per
              from public.product_presentations pp
             where pp.id = v_item.presentation_id and pp.product_id = v_source.id;
            if not found then
                raise exception 'La presentación no corresponde a este producto.';
            end if;
            if v_item.quantity <> trunc(v_item.quantity) then
                raise exception 'Las presentaciones van enteras: la cantidad tiene que ser un número entero.';
            end if;
        end if;
        v_base_qty := v_item.quantity * v_units_per;

        -- Mismo criterio que src/lib/units.ts: solo las unidades medibles
        -- admiten fracciones; cualquier otra (o una desconocida) va entera.
        if v_source.unit not in ('lb','kg','g','oz','qq','m','pie','yd','plg','gal','l','ml')
           and v_item.quantity <> trunc(v_item.quantity) then
            raise exception '«%» se cuenta por piezas: la cantidad tiene que ser entera.', v_source.name;
        end if;

        if v_source.stock < v_base_qty then
            raise exception 'No hay suficiente «%»: hay %, se quieren enviar %.',
                v_source.name, trim_scale(v_source.stock), trim_scale(v_base_qty);
        end if;

        v_target_product_id := null;
        v_target_active := null;
        v_created := false;
        v_reactivated := false;
        v_archived := false;

        -- El mismo artículo en el destino: por código y, si no, por nombre.
        -- Se prefiere uno activo; si solo hay uno archivado se reactiva, que
        -- sumarle stock a un archivado es esconderlo.
        if v_source.code is not null and v_source.code <> '' then
            select id, is_active into v_target_product_id, v_target_active
              from public.products
             where branch_id = p_to_branch_id and code = v_source.code
             order by is_active desc, created_at desc
             limit 1;
        end if;

        if v_target_product_id is null then
            select id, is_active into v_target_product_id, v_target_active
              from public.products
             where branch_id = p_to_branch_id and name = v_source.name
             order by is_active desc, created_at desc
             limit 1;
        end if;

        -- Sale de la sucursal que envía. Si queda en 0 y así se pidió, se
        -- archiva allá (archived_at lo pone trg_marcar_archivado_producto).
        v_archived := coalesce(p_archive_empty, false) and v_source.stock - v_base_qty = 0;
        update public.products
           set stock = stock - v_base_qty,
               is_active = case when v_archived then false else is_active end
         where id = v_source.id;

        if v_target_product_id is not null then
            v_reactivated := not v_target_active;

            update public.products
               set stock = stock + v_base_qty,
                   location_id = coalesce(location_id, p_target_location_id),
                   is_active = true
             where id = v_target_product_id;
        else
            -- Las categorías son por sucursal: se busca una del mismo nombre
            -- en el destino y, si no hay, se queda sin categoría.
            select c.id into v_target_category_id
              from public.product_categories c
             where c.branch_id = p_to_branch_id
               and c.name = (select name from public.product_categories where id = v_source.category_id)
             limit 1;

            insert into public.products (
                company_id, branch_id, name, code, price, cost, itbis,
                image, stock, category_id, description, supplier_id,
                location_id, unit, tracks_stock, wholesale_price, wholesale_min_quantity
            ) values (
                v_company, p_to_branch_id, v_source.name, v_source.code, v_source.price,
                v_source.cost, v_source.itbis, v_source.image, v_base_qty, v_target_category_id,
                v_source.description, v_source.supplier_id, p_target_location_id, v_source.unit,
                v_source.tracks_stock, v_source.wholesale_price, v_source.wholesale_min_quantity
            ) returning id into v_target_product_id;

            v_created := true;

            -- El producto nuevo trae todas las presentaciones del original (aunque
            -- el envío sea de una sola). El código de una presentación no puede
            -- repetirse en la sucursal (ni con un producto activo ni con otra
            -- presentación): si allá ya está ocupado, la copia queda sin código.
            -- Se comprueba antes de insertar, con el mismo criterio del trigger
            -- product_presentations_before_write, para que éste nunca falle.
            -- Si el producto ya existía en el destino no se tocan las suyas.
            for v_copy in
                select pp.name, pp.units, pp.price, pp.code
                  from public.product_presentations pp
                 where pp.product_id = v_source.id
                 order by pp.units, pp.created_at, pp.id
            loop
                v_copy_code := nullif(btrim(v_copy.code), '');
                if v_copy_code is not null and (
                    exists (select 1 from public.products p
                             where p.branch_id = p_to_branch_id
                               and p.is_active
                               and p.code is not null
                               and lower(btrim(p.code)) = lower(v_copy_code))
                    or exists (select 1 from public.product_presentations x
                                where x.branch_id = p_to_branch_id
                                  and x.code is not null and btrim(x.code) <> ''
                                  and lower(btrim(x.code)) = lower(v_copy_code))
                ) then
                    v_copy_code := null;
                end if;

                insert into public.product_presentations (product_id, name, units, price, code)
                values (v_target_product_id, v_copy.name, v_copy.units, v_copy.price, v_copy_code);
            end loop;
        end if;

        insert into public.product_transfers (
            company_id, batch_id, from_branch_id, to_branch_id, source_product_id, target_product_id,
            product_name, product_code, quantity, unit, unit_cost,
            target_created, target_reactivated, source_archived, created_by,
            presentation_name, units_per
        ) values (
            v_company, v_batch_id, p_from_branch_id, p_to_branch_id, v_source.id, v_target_product_id,
            v_source.name, nullif(v_source.code, ''), v_item.quantity, v_source.unit,
            v_source.cost * v_units_per,
            v_created, v_reactivated, v_archived, auth.uid(),
            v_pres_name, v_units_per
        );

        v_count := v_count + 1;
    end loop;

    return jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'number', v_number,
        'items', v_count
    );
end;
$function$;

