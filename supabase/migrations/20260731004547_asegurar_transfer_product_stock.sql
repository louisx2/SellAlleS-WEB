-- Rescatada de la base: se aplicó directo al proyecto remoto y nunca llegó al
-- repo. El SQL es el que quedó registrado en supabase_migrations, verbatim.
--
-- Endurece transfer_product_stock, que era SECURITY DEFINER sin candados:
-- fija search_path, exige que la empresa sea la del usuario (o super admin),
-- rechaza cantidades <= 0 y transferir a la misma sucursal, y quita el EXECUTE
-- a anon. También mueve el chequeo de stock después de las validaciones.

create or replace function public.transfer_product_stock(
    p_product_id uuid,
    p_quantity numeric,
    p_target_branch_id uuid,
    p_current_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_source public.products%rowtype;
    v_target_product_id uuid;
    v_company uuid;
begin
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'La cantidad a transferir debe ser mayor que cero.';
    end if;

    select * into v_source
      from public.products
     where id = p_product_id and branch_id = p_current_branch_id
       for update;

    if not found then
        raise exception 'Producto de origen no encontrado o no pertenece a la sucursal activa.';
    end if;

    v_company := v_source.company_id;

    if not (v_company = public.current_company_id() or public.is_super_admin()) then
        raise exception 'No tienes permiso para mover inventario de esta empresa.';
    end if;

    if not exists (
      select 1 from public.branches
       where id = p_target_branch_id and company_id = v_company
    ) then
        raise exception 'La sucursal destino no es válida.';
    end if;

    if p_target_branch_id = p_current_branch_id then
        raise exception 'La sucursal destino tiene que ser distinta de la de origen.';
    end if;

    if v_source.stock < p_quantity then
        raise exception 'Stock insuficiente para transferir.';
    end if;

    if v_source.code is not null and v_source.code <> '' then
        select id into v_target_product_id
          from public.products
         where branch_id = p_target_branch_id and code = v_source.code
         limit 1;
    end if;

    if v_target_product_id is null then
        select id into v_target_product_id
          from public.products
         where branch_id = p_target_branch_id and name = v_source.name
         limit 1;
    end if;

    update public.products
       set stock = stock - p_quantity
     where id = p_product_id;

    if v_target_product_id is not null then
        update public.products
           set stock = stock + p_quantity
         where id = v_target_product_id;
    else
        insert into public.products (
            company_id, branch_id, name, code, price, cost, itbis,
            image, stock, category_id, description, supplier_id,
            location_id, unit, tracks_stock, wholesale_price, wholesale_min_quantity
        ) values (
            v_company, p_target_branch_id, v_source.name, v_source.code, v_source.price,
            v_source.cost, v_source.itbis, v_source.image, p_quantity, v_source.category_id,
            v_source.description, v_source.supplier_id, v_source.location_id, v_source.unit,
            v_source.tracks_stock, v_source.wholesale_price, v_source.wholesale_min_quantity
        ) returning id into v_target_product_id;
    end if;

    return jsonb_build_object('success', true, 'target_product_id', v_target_product_id);
end;
$function$;

revoke all on function public.transfer_product_stock(uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.transfer_product_stock(uuid, numeric, uuid, uuid) to authenticated;
