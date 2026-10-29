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

