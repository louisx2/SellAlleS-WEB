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

  -- Un código no puede repetirse en la sucursal: ni con otro producto activo
  -- (los archivados no cuentan) ni con otra presentación, sin distinguir
  -- mayúsculas. En otra sucursal sí puede repetirse. El dueño que se nombra en
  -- el mensaje es el producto que ya lo usa.
  if new.code is not null then
    select p.name into v_owner
      from public.products p
     where p.branch_id = v_product.branch_id
       and p.is_active
       and p.id <> v_product.id
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
