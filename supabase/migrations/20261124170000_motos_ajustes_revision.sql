-- Motopréstamos 2A: ajustes de la revisión final. Las dos migraciones de 2A ya
-- están aplicadas; esto las corrige sin tocarlas.
--
-- 1. Borrar una empresa o una sucursal (súper admin) borra sus ventas, y la FK
--    vehicles.sale_id (on delete set null) deja la venta de la unidad en null:
--    vehicles_before lo tomaba por un cambio a mano y frenaba el borrado. Ahora lo
--    deja pasar cuando la venta ya no existe.
-- 2. La sucursal se lleva sus unidades (vehicles.branch_id on delete cascade),
--    igual que sus artículos.
-- 3. motos_recalcular_stock bloquea el artículo antes de contar: dos ventas a la
--    vez de chasis distintos del mismo modelo dejaban el stock con una de más.
-- 4. La descripción lleva chasis y motor antes que año y color: el e-CF corta el
--    nombre del artículo a 80 caracteres y lo que identifica la moto no se puede
--    perder. Espejo: vehicleLineName en src/lib/motos.ts.

-- 1. ---------------------------------------------------------------------------
create or replace function public.vehicles_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean := coalesce(current_setting('motos.sistema', true), '') = 'si';
begin
  new.chassis := nullif(btrim(new.chassis), '');
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.branches where id = new.branch_id and company_id = new.company_id) then
      raise exception 'Sucursal no válida.';
    end if;
    if not v_sistema then
      new.status := case new.origin when 'garantia' then 'en_garantia' else 'disponible' end;
      new.sale_id := null;
      if new.origin = 'inventario' then
        new.customer_id := null;
        new.registration_status := 'no_aplica';
      end if;
    end if;
    if new.origin = 'inventario' and not exists (
      select 1 from public.products p
       where p.id = new.product_id and p.is_vehicle
         and p.branch_id = new.branch_id and p.company_id = new.company_id
    ) then
      raise exception 'La unidad tiene que ser de un artículo-vehículo de la misma sucursal.';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name, (select name from public.profiles where id = auth.uid()));
    return new;
  end if;

  -- UPDATE: lo que cambia el estado, la venta o a quién pertenece lo hace el
  -- sistema (venta, préstamo, recuperación). El usuario solo da de baja una
  -- unidad disponible y edita datos descriptivos.
  if not v_sistema then
    if new.status is distinct from old.status
       and not (old.status = 'disponible' and new.status = 'baja') then
      raise exception 'Ese cambio de estado lo hace el sistema (venta, préstamo o recuperación).';
    end if;
    -- La venta solo queda en null sola cuando se borró (la FK, al borrar una
    -- empresa o una sucursal).
    if (new.sale_id is distinct from old.sale_id
        and not (new.sale_id is null and not exists (select 1 from public.sales where id = old.sale_id)))
       or new.product_id is distinct from old.product_id
       or new.branch_id is distinct from old.branch_id
       or new.company_id is distinct from old.company_id
       or new.origin is distinct from old.origin
       or new.registration_status is distinct from old.registration_status
       or (old.origin = 'inventario' and new.customer_id is distinct from old.customer_id) then
      raise exception 'Ese cambio lo hace el sistema (venta, préstamo o recuperación).';
    end if;
  end if;
  return new;
end;
$$;

-- 2. ---------------------------------------------------------------------------
alter table public.vehicles
  drop constraint vehicles_branch_id_fkey,
  add constraint vehicles_branch_id_fkey foreign key (branch_id)
    references public.branches(id) on delete cascade;

-- 3. ---------------------------------------------------------------------------
create or replace function public.motos_recalcular_stock(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product_id is null then
    return;
  end if;
  -- Primero el bloqueo, en su propia sentencia: si otra venta del mismo modelo
  -- está en curso, se espera a que termine y el conteo de abajo (otra sentencia,
  -- otra foto) ya ve su unidad vendida.
  perform 1 from public.products where id = p_product_id for update;
  perform set_config('motos.stock', 'si', true);
  update public.products p
     set stock = (select count(*) from public.vehicles v
                   where v.product_id = p.id and v.status = 'disponible')
   where p.id = p_product_id and p.is_vehicle;
  perform set_config('motos.stock', '', true);
end;
$$;

-- 4. ---------------------------------------------------------------------------
-- "Honda CG 150 · Chasis X · Motor Y · 2025 · Roja", sin lo que esté vacío.
create or replace function public.motos_descripcion(v public.vehicles)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' · ',
    nullif(btrim(concat_ws(' ', nullif(btrim(v.brand), ''), nullif(btrim(v.model), ''))), ''),
    'Chasis ' || nullif(btrim(v.chassis), ''),
    'Motor ' || nullif(btrim(v.engine_number), ''),
    v.year::text,
    nullif(btrim(v.color), ''));
$$;
