-- Motopréstamos 2A: vehículos con chasis y stock por unidad.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 2)
-- Plan:   docs/superpowers/plans/2026-11-23-motoprestamos-entrega-2a-vehiculos.md (Task 2)
--
-- Solo crea objetos y agrega columnas (products.is_vehicle, sale_items.vehicle_id);
-- no cambia ninguna función viva.
--
-- El stock de un artículo con is_vehicle es DERIVADO: lo recalcula el trigger de
-- `vehicles` con las unidades disponibles, y un guardia en `products` rechaza
-- cualquier otro cambio. Así compras, transferencias y ajustes manuales no pueden
-- crear motos sin chasis, sin tocarlos uno por uno.
-- Pruebas: supabase/tests/motos_vehiculos.sql

-- 1. Columnas en tablas existentes ---------------------------------------------

alter table public.products add column is_vehicle boolean not null default false;

-- 2. Tipos de vehículo (como service_equipment_types) --------------------------

create table public.vehicle_types (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  extra_fields jsonb not null default '[]'::jsonb,
  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index vehicle_types_company_idx on public.vehicle_types(company_id, position);

-- 3. Vehículos -------------------------------------------------------------------

create table public.vehicles (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id             uuid not null references public.branches(id),
  vehicle_type_id       uuid references public.vehicle_types(id) on delete set null,
  origin                text not null check (origin in ('inventario', 'garantia')),
  product_id            uuid references public.products(id),
  customer_id           uuid references public.customers(id),
  sale_id               uuid references public.sales(id) on delete set null,
  brand                 text,
  model                 text,
  year                  integer check (year is null or year between 1950 and 2100),
  color                 text,
  chassis               text,
  engine_number         text,
  plate                 text,
  registration_number   text,
  cc                    text,
  extra                 jsonb not null default '{}'::jsonb,
  condition             text not null default 'nuevo' check (condition in ('nuevo', 'usado')),
  cost                  numeric(14,2) check (cost is null or cost >= 0),
  price                 numeric(14,2) check (price is null or price >= 0),
  status                text not null default 'disponible'
                        check (status in ('disponible', 'vendido', 'en_garantia', 'recuperado', 'liberado', 'baja')),
  registration_status   text not null default 'no_aplica'
                        check (registration_status in ('en_custodia', 'lista_para_entregar', 'entregada', 'no_aplica')),
  registration_location text,
  registration_since    timestamptz,
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vehicles_origen_check check (
    (origin = 'inventario' and product_id is not null)
    or (origin = 'garantia' and customer_id is not null and product_id is null)
  )
);
-- Índice y no restricción: un chasis de baja se puede volver a registrar.
create unique index vehicles_chassis_uq on public.vehicles
  (company_id, upper(regexp_replace(chassis, '\s', '', 'g')))
  where status <> 'baja' and coalesce(btrim(chassis), '') <> '';
create index vehicles_branch_status_idx on public.vehicles(branch_id, status);
create index vehicles_product_idx on public.vehicles(product_id) where product_id is not null;
create index vehicles_sale_idx on public.vehicles(sale_id) where sale_id is not null;
create index vehicles_customer_idx on public.vehicles(customer_id) where customer_id is not null;

alter table public.sale_items add column vehicle_id uuid references public.vehicles(id);
create index sale_items_vehicle_idx on public.sale_items(vehicle_id) where vehicle_id is not null;

-- 4. Historial -------------------------------------------------------------------

create table public.vehicle_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  kind            text not null check (kind in ('ingreso', 'venta', 'venta_anulada', 'cambio_estado', 'matricula', 'edicion', 'baja')),
  from_status     text,
  to_status       text,
  note            text,
  sale_id         uuid references public.sales(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_by_name text,
  -- clock_timestamp: varios eventos de una transacción quedan en orden.
  created_at      timestamptz not null default clock_timestamp()
);
create index vehicle_events_vehicle_idx on public.vehicle_events(vehicle_id, created_at);

-- 5. Permisos (como taller_tiene_permiso / taller_puede_configurar) ---------------
-- Lo decide el rol que tiene EN la sucursal. Una fila sin rol cae a Cajero: ve los
-- vehículos (para venderlos en el POS), no los edita.

create or replace function public.motos_tiene_permiso(p_branch_id uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin() or public.is_super_admin() or exists (
    select 1
      from public.profile_branches pb
      left join public.roles r on r.id = pb.role_id
     where pb.profile_id = auth.uid()
       and pb.branch_id = p_branch_id
       and pb.company_id = public.current_company_id()
       and case
             when r.id is null then
               coalesce('{"motos":["view"],"pos":["view","create"]}'::jsonb -> p_resource, '[]'::jsonb) ? p_action
             else coalesce(r.permissions -> p_resource, '[]'::jsonb) ? p_action
           end
  );
$$;

create or replace function public.motos_puede_configurar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin() or public.is_super_admin() or exists (
    select 1
      from public.profile_branches pb
      join public.roles r on r.id = pb.role_id
     where pb.profile_id = auth.uid()
       and pb.company_id = public.current_company_id()
       and coalesce(r.permissions -> 'motos-config', '[]'::jsonb) ? 'edit'
  );
$$;

-- 6. Stock derivado y descripción --------------------------------------------------

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
  perform set_config('motos.stock', 'si', true);
  update public.products p
     set stock = (select count(*) from public.vehicles v
                   where v.product_id = p.id and v.status = 'disponible')
   where p.id = p_product_id and p.is_vehicle;
  perform set_config('motos.stock', '', true);
end;
$$;

-- "Honda CG 150 · 2025 · Roja · Chasis X · Motor Y", sin lo que esté vacío.
-- Espejo: vehicleLineName en src/lib/motos.ts.
create or replace function public.motos_descripcion(v public.vehicles)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' · ',
    nullif(btrim(concat_ws(' ', nullif(btrim(v.brand), ''), nullif(btrim(v.model), ''))), ''),
    v.year::text,
    nullif(btrim(v.color), ''),
    'Chasis ' || nullif(btrim(v.chassis), ''),
    'Motor ' || nullif(btrim(v.engine_number), ''));
$$;

-- 7. Triggers de vehículos ---------------------------------------------------------

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
    if new.sale_id is distinct from old.sale_id
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

create or replace function public.vehicles_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text := (select name from public.profiles where id = auth.uid());
  v_campos  text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.motos_recalcular_stock(new.product_id);
    insert into public.vehicle_events (company_id, vehicle_id, kind, to_status, created_by_name)
    values (new.company_id, new.id, 'ingreso', new.status, v_usuario);
    return new;
  end if;

  if new.product_id is distinct from old.product_id then
    perform public.motos_recalcular_stock(old.product_id);
  end if;
  if new.status is distinct from old.status or new.product_id is distinct from old.product_id then
    perform public.motos_recalcular_stock(new.product_id);
  end if;

  if new.status is distinct from old.status then
    -- Los ganchos de venta y anulación dicen qué evento es (motos.evento).
    insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, note, sale_id, created_by_name)
    values (new.company_id, new.id,
            coalesce(nullif(current_setting('motos.evento', true), ''),
                     case when new.status = 'baja' then 'baja' else 'cambio_estado' end),
            old.status, new.status,
            case when new.status = 'baja' then new.notes end,
            coalesce(new.sale_id, old.sale_id), v_usuario);
  end if;

  if new.registration_status is distinct from old.registration_status then
    insert into public.vehicle_events (company_id, vehicle_id, kind, from_status, to_status, sale_id, created_by_name)
    values (new.company_id, new.id, 'matricula', old.registration_status, new.registration_status,
            coalesce(new.sale_id, old.sale_id), v_usuario);
  end if;

  if new.status is not distinct from old.status then
    if new.brand is distinct from old.brand then v_campos := array_append(v_campos, 'marca'); end if;
    if new.model is distinct from old.model then v_campos := array_append(v_campos, 'modelo'); end if;
    if new.year is distinct from old.year then v_campos := array_append(v_campos, 'año'); end if;
    if new.color is distinct from old.color then v_campos := array_append(v_campos, 'color'); end if;
    if new.chassis is distinct from old.chassis then v_campos := array_append(v_campos, 'chasis'); end if;
    if new.engine_number is distinct from old.engine_number then v_campos := array_append(v_campos, 'motor'); end if;
    if new.plate is distinct from old.plate then v_campos := array_append(v_campos, 'placa'); end if;
    if new.registration_number is distinct from old.registration_number then v_campos := array_append(v_campos, 'matrícula'); end if;
    if new.registration_location is distinct from old.registration_location then v_campos := array_append(v_campos, 'ubicación de la matrícula'); end if;
    if new.cc is distinct from old.cc then v_campos := array_append(v_campos, 'cilindraje'); end if;
    if new.vehicle_type_id is distinct from old.vehicle_type_id then v_campos := array_append(v_campos, 'tipo'); end if;
    if new.extra is distinct from old.extra then v_campos := array_append(v_campos, 'datos extra'); end if;
    if new.condition is distinct from old.condition then v_campos := array_append(v_campos, 'condición'); end if;
    if new.cost is distinct from old.cost then v_campos := array_append(v_campos, 'costo'); end if;
    if new.price is distinct from old.price then v_campos := array_append(v_campos, 'precio'); end if;
    if new.notes is distinct from old.notes then v_campos := array_append(v_campos, 'notas'); end if;
    if array_length(v_campos, 1) > 0 then
      insert into public.vehicle_events (company_id, vehicle_id, kind, note, created_by_name)
      values (new.company_id, new.id, 'edicion', 'Cambió: ' || array_to_string(v_campos, ', '), v_usuario);
    end if;
  end if;

  return new;
end;
$$;

create trigger vehicles_before before insert or update on public.vehicles
  for each row execute function public.vehicles_before();
create trigger vehicles_after after insert or update on public.vehicles
  for each row execute function public.vehicles_after();

-- 8. Guardia del stock de los artículos-vehículo ---------------------------------

create or replace function public.products_vehicle_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_vehicle and new.stock <> 0 then
      raise exception 'Para marcarlo como vehículo, deja sus existencias en 0 e ingresa cada unidad desde Vehículos.';
    end if;
    return new;
  end if;

  if new.is_vehicle and not old.is_vehicle and new.stock <> 0 then
    raise exception 'Para marcarlo como vehículo, deja sus existencias en 0 e ingresa cada unidad desde Vehículos.';
  end if;
  if old.is_vehicle and not new.is_vehicle
     and exists (select 1 from public.vehicles where product_id = old.id and status <> 'baja') then
    raise exception 'Este artículo tiene vehículos registrados: dalos de baja antes de quitarle la marca.';
  end if;
  if new.is_vehicle and old.is_vehicle and new.stock is distinct from old.stock
     and coalesce(current_setting('motos.stock', true), '') <> 'si' then
    raise exception 'Las existencias de un vehículo las mueven sus unidades: ingrésalas o dalas de baja desde Vehículos.';
  end if;
  return new;
end;
$$;

create trigger products_vehicle_guard before insert or update on public.products
  for each row execute function public.products_vehicle_guard();

-- Empresa suspendida: como el resto de tablas de la empresa.
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.vehicles
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.vehicle_types
  for each row execute function public.bloquear_si_empresa_suspendida();

-- 9. RLS -------------------------------------------------------------------------

alter table public.vehicle_types enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_events enable row level security;

create policy vehicle_types_select on public.vehicle_types
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy vehicle_types_write on public.vehicle_types
  for all using ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin());

-- Ver: quien ve Vehículos, y quien vende en el POS (elige el chasis al cobrar).
create policy vehicles_select on public.vehicles
  for select using (
    (company_id = public.current_company_id()
     and (public.motos_tiene_permiso(branch_id, 'motos', 'view') or public.motos_tiene_permiso(branch_id, 'pos', 'view')))
    or public.is_super_admin());
create policy vehicles_insert on public.vehicles
  for insert with check (
    (company_id = public.current_company_id() and public.motos_tiene_permiso(branch_id, 'motos', 'create'))
    or public.is_super_admin());
create policy vehicles_update on public.vehicles
  for update using (
    (company_id = public.current_company_id() and public.motos_tiene_permiso(branch_id, 'motos', 'edit'))
    or public.is_super_admin())
  with check (
    (company_id = public.current_company_id() and public.motos_tiene_permiso(branch_id, 'motos', 'edit'))
    or public.is_super_admin());
-- Sin delete: una unidad se da de baja.

create policy vehicle_events_select on public.vehicle_events
  for select using (company_id = public.current_company_id() or public.is_super_admin());

-- 10. Grants -----------------------------------------------------------------------

-- Este proyecto todavía da permisos por defecto a lo nuevo (el cambio de Supabase
-- del 30-oct no ha llegado): se quitan primero y se dan solo los que hacen falta.
revoke all on public.vehicle_types, public.vehicles, public.vehicle_events from public, anon, authenticated;
grant select, insert, update, delete on public.vehicle_types to authenticated, service_role;
grant select, insert, update on public.vehicles to authenticated;
grant select, insert, update, delete on public.vehicles to service_role;
grant select on public.vehicle_events to authenticated;
grant select, insert, update, delete on public.vehicle_events to service_role;

revoke execute on function public.motos_tiene_permiso(uuid, text, text) from public, anon;
revoke execute on function public.motos_puede_configurar() from public, anon;
revoke execute on function public.motos_recalcular_stock(uuid) from public, anon, authenticated;
revoke execute on function public.motos_descripcion(public.vehicles) from public, anon;
revoke execute on function public.vehicles_before() from public, anon, authenticated;
revoke execute on function public.vehicles_after() from public, anon, authenticated;
revoke execute on function public.products_vehicle_guard() from public, anon, authenticated;

grant execute on function public.motos_tiene_permiso(uuid, text, text) to authenticated, service_role;
grant execute on function public.motos_puede_configurar() to authenticated, service_role;
grant execute on function public.motos_recalcular_stock(uuid) to service_role;
grant execute on function public.motos_descripcion(public.vehicles) to authenticated, service_role;
