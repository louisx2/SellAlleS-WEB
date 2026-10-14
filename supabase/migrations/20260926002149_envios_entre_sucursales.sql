-- Envíos entre sucursales: varios artículos por envío, con número de conduce,
-- y los puede hacer quien edita el inventario de la sucursal que envía.
--
-- Por qué: en Pujols Group (DelmasTechnology) se hizo UNA transferencia del 16
-- al 25 de septiembre teniendo 3 sucursales. Solo los admin de la empresa
-- podían transferir, pero los gerentes y administradores de sucursal sí podían
-- crear artículos. Entonces la mercancía que se movía se cargaba a mano en la
-- sucursal que la recibía y la que la mandaba nunca descontaba (el cargador
-- 1HORA del 23 de septiembre: 9 creados a mano en R.A., Principal sin tocar).
--
-- Qué cambia:
--   * Quién: el admin de la empresa, o quien tenga Inventario → Editar en el
--     rol que tiene EN LA SUCURSAL QUE ENVÍA (profile_branches.role_id). Es el
--     mismo criterio con el que la pantalla le deja editar ese inventario.
--   * Un envío (product_transfer_batches) agrupa varios artículos y lleva un
--     número consecutivo por empresa: el del conduce. Cada artículo sigue
--     siendo una fila de product_transfers, ahora con su batch_id.
--   * Si el artículo queda en 0 en la sucursal que envía, se archiva allá (si
--     se pide): un iPhone con IMEI que se mandó a otra tienda no tiene nada que
--     hacer en el inventario de la primera. Archivado, no borrado: su historial
--     sigue, y si vuelve por transferencia se reactiva solo.
--   * El historial lo ven también las sucursales involucradas, no solo el admin.
--   * buscar_en_otras_sucursales: para avisar, al crear un artículo, que ya hay
--     existencias de ese código en otra sucursal (y que lo que toca es
--     transferir, no crearlo otra vez).
--   * transfer_product_stock queda como envoltura de transfer_products para
--     los clientes con la versión anterior en caché (PWA).

-- ── Permiso ────────────────────────────────────────────────────────────────
-- Espejo en la base de usePermission('products', 'edit') en la sucursal dada.
create or replace function public.puede_editar_inventario(p_branch_id uuid)
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
       and coalesce(r.permissions -> 'products', '[]'::jsonb) ? 'edit'
  );
$$;

comment on function public.puede_editar_inventario(uuid) is
  'Si el usuario puede editar el inventario de esa sucursal: admin de la empresa, o su rol en esa sucursal tiene products → edit.';

revoke all on function public.puede_editar_inventario(uuid) from public, anon;
grant execute on function public.puede_editar_inventario(uuid) to authenticated;

-- ── Envíos ─────────────────────────────────────────────────────────────────
create table public.product_transfer_batches (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    number integer not null check (number > 0),
    from_branch_id uuid not null references public.branches(id) on delete cascade,
    to_branch_id uuid not null references public.branches(id) on delete cascade,
    notes text,
    created_by uuid references public.profiles(id) on delete set null,
    -- Copia del nombre: el conduce se reimprime igual aunque la persona se vaya.
    created_by_name text,
    created_at timestamptz not null default now(),
    constraint product_transfer_batches_number_key unique (company_id, number)
);

comment on table public.product_transfer_batches is
  'Un envío de mercancía entre dos sucursales de la misma empresa. Sus artículos están en product_transfers.batch_id.';
comment on column public.product_transfer_batches.number is
  'Número del conduce, consecutivo por empresa. Lo asigna transfer_products, nunca el cliente.';

create index product_transfer_batches_company_created_idx
    on public.product_transfer_batches (company_id, created_at desc);
create index product_transfer_batches_from_branch_idx on public.product_transfer_batches (from_branch_id);
create index product_transfer_batches_to_branch_idx on public.product_transfer_batches (to_branch_id);
create index product_transfer_batches_created_by_idx on public.product_transfer_batches (created_by);

alter table public.product_transfers
    add column batch_id uuid references public.product_transfer_batches(id) on delete cascade,
    add column unit text,
    add column unit_cost numeric,
    add column source_archived boolean not null default false;

comment on column public.product_transfers.unit is 'Unidad del artículo al enviarlo (copia).';
comment on column public.product_transfers.unit_cost is 'Costo unitario del artículo en la sucursal que envía, al enviarlo (copia).';
comment on column public.product_transfers.source_archived is 'Si el artículo quedó en 0 en la sucursal que envía y se archivó allá.';

create index product_transfers_batch_idx on public.product_transfers (batch_id);

-- Las transferencias sueltas de antes pasan a ser envíos de un artículo, en el
-- orden en que se hicieron, para que el historial sea uno solo.
do $$
declare
    r record;
    v_batch uuid;
    v_number integer;
begin
    for r in
        select t.*, p.name as creador
          from public.product_transfers t
          left join public.profiles p on p.id = t.created_by
         where t.batch_id is null
         order by t.company_id, t.created_at, t.id
    loop
        select coalesce(max(number), 0) + 1 into v_number
          from public.product_transfer_batches where company_id = r.company_id;

        insert into public.product_transfer_batches
            (company_id, number, from_branch_id, to_branch_id, created_by, created_by_name, created_at)
        values
            (r.company_id, v_number, r.from_branch_id, r.to_branch_id, r.created_by, r.creador, r.created_at)
        returning id into v_batch;

        update public.product_transfers t
           set batch_id = v_batch,
               unit = coalesce(t.unit, (select unit from public.products where id = r.source_product_id)),
               unit_cost = coalesce(t.unit_cost, (select cost from public.products where id = r.source_product_id))
         where t.id = r.id;
    end loop;
end;
$$;

alter table public.product_transfers alter column batch_id set not null;

-- Para el aviso de "ya existe en otra sucursal" y para emparejar por código.
create index if not exists products_company_code_idx
    on public.products (company_id, code)
    where code is not null and code <> '';

-- ── Quién ve el historial ──────────────────────────────────────────────────
-- El admin de la empresa, y quien tenga acceso a la sucursal que envió o a la
-- que recibió. Nadie escribe directo: solo transfer_products.
alter table public.product_transfer_batches enable row level security;

create policy product_transfer_batches_select on public.product_transfer_batches
    for select to authenticated
    using (
        (company_id = (select public.current_company_id()) and (
            (select public.is_company_admin())
            or from_branch_id in (select public.user_branch_ids())
            or to_branch_id in (select public.user_branch_ids())
        ))
        or (select public.is_super_admin())
    );

revoke all on public.product_transfer_batches from anon;
revoke insert, update, delete on public.product_transfer_batches from authenticated;
grant select on public.product_transfer_batches to authenticated;

drop policy if exists product_transfers_select on public.product_transfers;
create policy product_transfers_select on public.product_transfers
    for select to authenticated
    using (
        (company_id = (select public.current_company_id()) and (
            (select public.is_company_admin())
            or from_branch_id in (select public.user_branch_ids())
            or to_branch_id in (select public.user_branch_ids())
        ))
        or (select public.is_super_admin())
    );

-- ── Enviar ─────────────────────────────────────────────────────────────────
-- p_items: [{"product_id": uuid, "quantity": numeric}, ...]. Todo o nada: si un
-- artículo no se puede mandar, no sale ninguno.
create or replace function public.transfer_products(
    p_from_branch_id uuid,
    p_to_branch_id uuid,
    p_items jsonb,
    p_target_location_id uuid default null,
    p_archive_empty boolean default true,
    p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    -- Un mismo artículo dos veces en la lista se suma en una línea. Se recorren
    -- en orden de id para que dos envíos simultáneos bloqueen las filas en el
    -- mismo orden y no se traben entre sí.
    for v_item in
        select x.product_id, sum(x.quantity) as quantity
          from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
         group by x.product_id
         order by x.product_id
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

        -- Mismo criterio que src/lib/units.ts: solo las unidades medibles
        -- admiten fracciones; cualquier otra (o una desconocida) va entera.
        if v_source.unit not in ('lb','kg','g','oz','qq','m','pie','yd','plg','gal','l','ml')
           and v_item.quantity <> trunc(v_item.quantity) then
            raise exception '«%» se cuenta por piezas: la cantidad tiene que ser entera.', v_source.name;
        end if;

        if v_source.stock < v_item.quantity then
            raise exception 'No hay suficiente «%»: hay %, se quieren enviar %.',
                v_source.name, trim_scale(v_source.stock), trim_scale(v_item.quantity);
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
        v_archived := coalesce(p_archive_empty, false) and v_source.stock - v_item.quantity = 0;
        update public.products
           set stock = stock - v_item.quantity,
               is_active = case when v_archived then false else is_active end
         where id = v_source.id;

        if v_target_product_id is not null then
            v_reactivated := not v_target_active;

            update public.products
               set stock = stock + v_item.quantity,
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
                v_source.cost, v_source.itbis, v_source.image, v_item.quantity, v_target_category_id,
                v_source.description, v_source.supplier_id, p_target_location_id, v_source.unit,
                v_source.tracks_stock, v_source.wholesale_price, v_source.wholesale_min_quantity
            ) returning id into v_target_product_id;

            v_created := true;
        end if;

        insert into public.product_transfers (
            company_id, batch_id, from_branch_id, to_branch_id, source_product_id, target_product_id,
            product_name, product_code, quantity, unit, unit_cost,
            target_created, target_reactivated, source_archived, created_by
        ) values (
            v_company, v_batch_id, p_from_branch_id, p_to_branch_id, v_source.id, v_target_product_id,
            v_source.name, nullif(v_source.code, ''), v_item.quantity, v_source.unit, v_source.cost,
            v_created, v_reactivated, v_archived, auth.uid()
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

comment on function public.transfer_products(uuid, uuid, jsonb, uuid, boolean, text) is
  'Envía varios artículos de una sucursal a otra en una sola transacción y devuelve el envío con su número de conduce.';

revoke all on function public.transfer_products(uuid, uuid, jsonb, uuid, boolean, text) from public, anon;
grant execute on function public.transfer_products(uuid, uuid, jsonb, uuid, boolean, text) to authenticated;

-- ── Compatibilidad ─────────────────────────────────────────────────────────
-- La pantalla anterior llama a transfer_product_stock con un solo artículo.
-- Sigue funcionando igual (sin archivar el origen), pero ya por el camino
-- nuevo: queda como envío numerado y con el permiso nuevo.
drop function if exists public.transfer_product_stock(uuid, numeric, uuid, uuid);

create or replace function public.transfer_product_stock(
    p_product_id uuid,
    p_quantity numeric,
    p_target_branch_id uuid,
    p_current_branch_id uuid,
    p_target_location_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_result jsonb;
    v_row public.product_transfers%rowtype;
begin
    v_result := public.transfer_products(
        p_current_branch_id,
        p_target_branch_id,
        jsonb_build_array(jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity)),
        p_target_location_id,
        false,
        null
    );

    select * into v_row from public.product_transfers
     where batch_id = (v_result ->> 'batch_id')::uuid
     limit 1;

    return jsonb_build_object(
        'success', true,
        'batch_id', v_result -> 'batch_id',
        'number', v_result -> 'number',
        'target_product_id', v_row.target_product_id,
        'target_created', v_row.target_created,
        'target_reactivated', v_row.target_reactivated
    );
end;
$function$;

revoke all on function public.transfer_product_stock(uuid, numeric, uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_product_stock(uuid, numeric, uuid, uuid, uuid) to authenticated;

-- ── ¿Ya existe en otra sucursal? ───────────────────────────────────────────
-- Artículos activos y con existencias en OTRAS sucursales de la empresa con el
-- mismo código o el mismo nombre (sin distinguir mayúsculas ni espacios de los
-- bordes). Devuelve lo justo para el aviso: dónde está, cuánto hay, y si quien
-- pregunta podría transferirlo desde allá.
create or replace function public.buscar_en_otras_sucursales(
    p_branch_id uuid,
    p_code text,
    p_name text
) returns table (
    branch_id uuid,
    branch_name text,
    product_id uuid,
    product_name text,
    product_code text,
    stock numeric,
    unit text,
    can_transfer boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
    v_company uuid;
    v_code text := nullif(btrim(p_code), '');
    v_name text := nullif(lower(btrim(p_name)), '');
begin
    select b.company_id into v_company from public.branches b where b.id = p_branch_id;

    if v_company is null
       or v_company is distinct from public.current_company_id()
       or not (public.is_company_admin() or p_branch_id in (select public.user_branch_ids())) then
        return;
    end if;

    if v_code is null and v_name is null then
        return;
    end if;

    return query
    select p.branch_id, b.name, p.id, p.name, p.code, p.stock, p.unit,
           (public.is_company_admin() or p.branch_id in (select public.user_branch_ids()))
             and public.puede_editar_inventario(p.branch_id)
      from public.products p
      join public.branches b on b.id = p.branch_id
     where p.company_id = v_company
       and p.branch_id <> p_branch_id
       and p.is_active
       and p.tracks_stock
       and p.stock > 0
       and coalesce(b.is_active, true)
       and ((v_code is not null and p.code = v_code)
            or (v_name is not null and lower(btrim(p.name)) = v_name))
     order by p.stock desc
     limit 10;
end;
$function$;

revoke all on function public.buscar_en_otras_sucursales(uuid, text, text) from public, anon;
grant execute on function public.buscar_en_otras_sucursales(uuid, text, text) to authenticated;
