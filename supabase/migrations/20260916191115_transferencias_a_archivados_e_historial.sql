-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo (su propio comentario dice "ver el archivo del repo", pero el archivo no
-- existía). El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Qué hizo, para el que llegue aquí sin contexto:
--   * Crea product_transfers: una fila por cada transferencia entre sucursales.
--   * transfer_product_stock pasa a recibir la ubicación en la sucursal destino
--     (p_target_location_id), exige admin de la empresa, busca la categoría del
--     mismo nombre en el destino en vez de copiar un id de otra sucursal, y si el
--     artículo existía archivado en el destino lo reactiva: antes le sumaba el
--     stock a un artículo que nadie veía y la transferencia "no aparecía".
--
-- Ojo: la versión de 4 parámetros (20260731004547) ya no existe en la base; se
-- quitó a mano. La siguiente migración la borra también para que una base
-- recreada desde el repo quede igual.

-- Transferir entre sucursales: no esconder el stock en artículos archivados, y
-- dejar constancia de cada transferencia. Ver el archivo del repo para el contexto.

create table if not exists public.product_transfers (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    from_branch_id uuid not null references public.branches(id) on delete cascade,
    to_branch_id uuid not null references public.branches(id) on delete cascade,
    source_product_id uuid references public.products(id) on delete set null,
    target_product_id uuid references public.products(id) on delete set null,
    product_name text not null,
    product_code text,
    quantity numeric not null check (quantity > 0),
    target_created boolean not null default false,
    target_reactivated boolean not null default false,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists product_transfers_company_created_idx
    on public.product_transfers (company_id, created_at desc);
create index if not exists product_transfers_from_branch_idx on public.product_transfers (from_branch_id);
create index if not exists product_transfers_to_branch_idx on public.product_transfers (to_branch_id);
create index if not exists product_transfers_source_product_idx on public.product_transfers (source_product_id);
create index if not exists product_transfers_target_product_idx on public.product_transfers (target_product_id);
create index if not exists product_transfers_created_by_idx on public.product_transfers (created_by);

alter table public.product_transfers enable row level security;

drop policy if exists product_transfers_select on public.product_transfers;
create policy product_transfers_select on public.product_transfers
    for select to authenticated
    using (
        (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
        or (select public.is_super_admin())
    );

revoke all on public.product_transfers from anon;
revoke insert, update, delete on public.product_transfers from authenticated;
grant select on public.product_transfers to authenticated;

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
    v_source public.products%rowtype;
    v_target_product_id uuid;
    v_target_active boolean;
    v_company uuid;
    v_target_category_id uuid;
    v_created boolean := false;
    v_reactivated boolean := false;
begin
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'La cantidad a transferir debe ser mayor que cero.';
    end if;

    if not public.is_company_admin() then
        raise exception 'Solo un administrador puede transferir artículos entre sucursales.';
    end if;

    select * into v_source from public.products
     where id = p_product_id and branch_id = p_current_branch_id for update;
    if not found then
        raise exception 'Producto de origen no encontrado o no pertenece a la sucursal activa.';
    end if;

    v_company := v_source.company_id;

    if not (v_company = public.current_company_id() or public.is_super_admin()) then
        raise exception 'No tienes permiso para mover inventario de esta empresa.';
    end if;

    if not exists (select 1 from public.branches where id = p_target_branch_id and company_id = v_company) then
        raise exception 'La sucursal destino no es válida.';
    end if;

    if p_target_branch_id = p_current_branch_id then
        raise exception 'La sucursal destino tiene que ser distinta de la de origen.';
    end if;

    if p_target_location_id is not null and not exists (
      select 1 from public.product_locations
       where id = p_target_location_id and branch_id = p_target_branch_id) then
        raise exception 'La ubicación elegida no es de la sucursal destino.';
    end if;

    if v_source.stock < p_quantity then
        raise exception 'Stock insuficiente para transferir.';
    end if;

    if v_source.code is not null and v_source.code <> '' then
        select id, is_active into v_target_product_id, v_target_active
          from public.products
         where branch_id = p_target_branch_id and code = v_source.code
         order by is_active desc, created_at desc
         limit 1;
    end if;

    if v_target_product_id is null then
        select id, is_active into v_target_product_id, v_target_active
          from public.products
         where branch_id = p_target_branch_id and name = v_source.name
         order by is_active desc, created_at desc
         limit 1;
    end if;

    update public.products set stock = stock - p_quantity where id = p_product_id;

    if v_target_product_id is not null then
        v_reactivated := not v_target_active;

        update public.products
           set stock = stock + p_quantity,
               location_id = coalesce(location_id, p_target_location_id),
               is_active = true
         where id = v_target_product_id;
    else
        select c.id into v_target_category_id
          from public.product_categories c
         where c.branch_id = p_target_branch_id
           and c.name = (select name from public.product_categories where id = v_source.category_id)
         limit 1;

        insert into public.products (
            company_id, branch_id, name, code, price, cost, itbis,
            image, stock, category_id, description, supplier_id,
            location_id, unit, tracks_stock, wholesale_price, wholesale_min_quantity
        ) values (
            v_company, p_target_branch_id, v_source.name, v_source.code, v_source.price,
            v_source.cost, v_source.itbis, v_source.image, p_quantity, v_target_category_id,
            v_source.description, v_source.supplier_id, p_target_location_id, v_source.unit,
            v_source.tracks_stock, v_source.wholesale_price, v_source.wholesale_min_quantity
        ) returning id into v_target_product_id;

        v_created := true;
    end if;

    insert into public.product_transfers (
        company_id, from_branch_id, to_branch_id, source_product_id, target_product_id,
        product_name, product_code, quantity, target_created, target_reactivated, created_by
    ) values (
        v_company, p_current_branch_id, p_target_branch_id, p_product_id, v_target_product_id,
        v_source.name, nullif(v_source.code, ''), p_quantity, v_created, v_reactivated, auth.uid()
    );

    return jsonb_build_object(
        'success', true,
        'target_product_id', v_target_product_id,
        'target_created', v_created,
        'target_reactivated', v_reactivated
    );
end;
$function$;

revoke all on function public.transfer_product_stock(uuid, numeric, uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_product_stock(uuid, numeric, uuid, uuid, uuid) to authenticated;
