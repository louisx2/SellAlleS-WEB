-- =============================================================================
-- Taller (entrega 1): el módulo de servicios rehecho como taller de reparación.
-- Diseño: docs/superpowers/specs/2026-11-19-taller-design.md
--
-- Lo que hace:
--   1. Configuración: tipos de equipo, chequeos de llegada, técnicos, ajustes
--      por sucursal (ubicación de repuestos, condiciones del recibo).
--   2. El caso (`services`): número por empresa, ficha del equipo, chequeos,
--      quién lo trajo / recibió / entregó / retiró, 9 estados, historial.
--   3. Líneas (`service_items`): mano de obra (artículo de servicio del
--      catálogo) y piezas (salen del inventario al agregarlas).
--   4. Cobro por el POS: la venta lleva `service_id` y cada línea del taller
--      `service_item_id`; el stock de esas líneas no se vuelve a descontar, y
--      anular la venta no lo repone y deja el caso por cobrar.
--   5. Permiso nuevo `services-all` (ver todos los casos): sin él, cada quien
--      ve los suyos y los sin asignar. Se aplica en la RLS.
--
-- `services` y `service_items` están vacías en producción (0 órdenes al
-- 2026-11-19): los cambios de estados no tienen datos que convertir.
--
-- create_sale_with_items, annul_sale, decrement_product_stock_for_sale_item y
-- seed_system_roles se modifican sobre su definición VIVA, comprobando antes su
-- huella md5: si alguien las cambió desde que se escribió esta migración, falla
-- sin tocar nada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Permisos: ¿qué puede hacer el usuario con el taller de una sucursal?
-- -----------------------------------------------------------------------------

-- Lo decide el rol que tiene EN la sucursal (profile_branches.role_id), igual que
-- usePermission en la app. El administrador de la empresa puede todo. Una fila
-- sin rol cae a Cajero, que es lo que hace la app.
create or replace function public.taller_tiene_permiso(p_branch_id uuid, p_resource text, p_action text)
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
               coalesce('{"services":["view","create","edit"],"services-all":["view"]}'::jsonb -> p_resource, '[]'::jsonb) ? p_action
             else coalesce(r.permissions -> p_resource, '[]'::jsonb) ? p_action
           end
  );
$$;

-- Configurar el taller (tipos de equipo, chequeos, catálogo, técnicos): el
-- administrador o quien tenga "Configuración del Taller → Editar" en alguna
-- sucursal de la empresa.
create or replace function public.taller_puede_configurar()
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
       and coalesce(r.permissions -> 'service-types', '[]'::jsonb) ? 'edit'
  );
$$;

revoke execute on function public.taller_tiene_permiso(uuid, text, text) from public, anon;
revoke execute on function public.taller_puede_configurar() from public, anon;
grant execute on function public.taller_tiene_permiso(uuid, text, text) to authenticated, service_role;
grant execute on function public.taller_puede_configurar() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Configuración
-- -----------------------------------------------------------------------------

-- Tipos de equipo: "Teléfono", "Laptop", "Vehículo"… Cada uno dice cómo se
-- llama su número de serie, si pide clave y qué campos extra lleva.
create table public.service_equipment_types (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  name          text not null check (btrim(name) <> ''),
  serial_label  text not null default 'Serie' check (btrim(serial_label) <> ''),
  asks_password boolean not null default false,
  -- [{ "key": "km", "label": "Kilometraje", "type": "text" | "number" }]
  extra_fields  jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_fields) = 'array'),
  position      integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index service_equipment_types_company_idx on public.service_equipment_types(company_id, position);

-- Chequeos de llegada. Sin tipo de equipo = aplica a todos.
create table public.service_checklist_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  equipment_type_id uuid references public.service_equipment_types(id) on delete cascade,
  label             text not null check (btrim(label) <> ''),
  required          boolean not null default false,
  required_quick    boolean not null default false,
  position          integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index service_checklist_items_company_idx on public.service_checklist_items(company_id, equipment_type_id, position);

-- Técnicos de cada sucursal: los únicos a los que se les puede asignar un caso.
create table public.service_technicians (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
-- Índice único y NO restricción `unique`: con las dos columnas con FK dentro de una
-- clave, PostgREST toma la tabla por puente entre branches y profiles, y los embed
-- que hoy resuelven bien pasan a responder 300 (ver el incidente de branch_sharing,
-- 2026-07-31). El índice impide los duplicados igual y no crea esa relación.
create unique index service_technicians_branch_profile_uq on public.service_technicians(branch_id, profile_id);

-- Ajustes del taller por sucursal.
create table public.taller_settings (
  branch_id             uuid primary key references public.branches(id) on delete cascade,
  company_id            uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  -- De aquí salen las piezas que se ofrecen en un caso. Sin ubicación, todas.
  parts_location_id     uuid references public.product_locations(id) on delete set null,
  -- Que las piezas de esa ubicación no aparezcan en el POS (se venden solo por el taller).
  hide_parts_in_pos     boolean not null default false,
  -- Condiciones impresas en el recibo de recepción.
  terms                 text,
  default_warranty_days integer check (default_warranty_days >= 0),
  updated_at            timestamptz not null default now()
);

alter table public.service_equipment_types enable row level security;
alter table public.service_checklist_items enable row level security;
alter table public.service_technicians enable row level security;
alter table public.taller_settings enable row level security;

create policy service_equipment_types_select on public.service_equipment_types
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy service_equipment_types_write on public.service_equipment_types
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin());

create policy service_checklist_items_select on public.service_checklist_items
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy service_checklist_items_write on public.service_checklist_items
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin());

create policy service_technicians_select on public.service_technicians
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy service_technicians_write on public.service_technicians
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin());

create policy taller_settings_select on public.taller_settings
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy taller_settings_write on public.taller_settings
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin());

grant select, insert, update, delete on public.service_equipment_types to authenticated, service_role;
grant select, insert, update, delete on public.service_checklist_items to authenticated, service_role;
grant select, insert, update, delete on public.service_technicians to authenticated, service_role;
grant select, insert, update, delete on public.taller_settings to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Catálogo de servicios (service_types)
-- -----------------------------------------------------------------------------
-- Cada servicio del catálogo tiene su artículo de servicio en la sucursal
-- (tracks_stock = false, es_servicio = true): de ahí salen precio, ITBIS e
-- indicador de servicio del e-CF, y así se cobra en el POS como cualquier línea.

alter table public.service_types
  add column branch_id         uuid references public.branches(id) on delete cascade,
  add column product_id        uuid references public.products(id) on delete set null,
  add column equipment_type_id uuid references public.service_equipment_types(id) on delete set null,
  add column part_category_id  uuid references public.product_categories(id) on delete set null,
  add column warranty_days     integer check (warranty_days >= 0),
  add column is_active         boolean not null default true,
  add column position          integer not null default 0;

alter table public.service_types alter column company_id set default public.current_company_id();
create unique index service_types_product_uq on public.service_types(product_id) where product_id is not null;
create index service_types_branch_idx on public.service_types(branch_id, position);

drop policy if exists "Solo administradores pueden gestionar tipos de servicio" on public.service_types;
create policy service_types_write on public.service_types
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 3. El caso (services)
-- -----------------------------------------------------------------------------

alter table public.services drop constraint services_status_check;

alter table public.services
  alter column service_type_id drop not null,
  alter column company_id set default public.current_company_id(),
  alter column status set default 'received',
  add column number             integer,
  add column equipment_type_id  uuid references public.service_equipment_types(id) on delete set null,
  add column equipment_brand    text,
  add column equipment_model    text,
  add column equipment_serial   text,
  add column equipment_password text,
  add column equipment_details  jsonb not null default '{}'::jsonb check (jsonb_typeof(equipment_details) = 'object'),
  add column accessories        text,
  -- Copia de lo contestado al ingresar: [{ item_id, label, answer: si|no|np, note }].
  -- Es copia a propósito: quitar un chequeo de la configuración no cambia los casos viejos.
  add column intake_checklist   jsonb not null default '[]'::jsonb check (jsonb_typeof(intake_checklist) = 'array'),
  add column diagnosis          text,
  add column brought_by_name    text,
  add column brought_by_phone   text,
  add column received_by        uuid references public.profiles(id) on delete set null,
  add column received_by_name   text,
  add column estimate           numeric(12,2) check (estimate >= 0),
  add column promised_at        timestamptz,
  add column is_quick           boolean not null default false,
  add column status_changed_at  timestamptz not null default now(),
  add column ready_at           timestamptz,
  add column delivered_at       timestamptz,
  add column delivered_by       uuid references public.profiles(id) on delete set null,
  add column delivered_by_name  text,
  add column picked_up_by_name  text,
  add column outcome            text check (outcome in ('repaired', 'not_repaired')),
  add column sale_id            uuid references public.sales(id) on delete set null;

update public.services
   set status = case status
                  when 'pending' then 'received'
                  when 'in_progress' then 'in_repair'
                  when 'completed' then 'ready'
                  else status
                end;

alter table public.services add constraint services_status_check check (status in (
  'received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair',
  'ready', 'not_repaired', 'delivered', 'cancelled'
));

-- Número para las filas viejas (no hay en producción, pero que no quede nulo).
with numerados as (
  select id, row_number() over (partition by company_id order by created_at, id) as n
    from public.services
)
update public.services s set number = numerados.n from numerados where numerados.id = s.id;
alter table public.services alter column number set not null;

create unique index services_company_number_uq on public.services(company_id, number);
create index services_branch_status_idx on public.services(branch_id, status);
create index services_assigned_idx on public.services(assigned_to) where assigned_to is not null;
create unique index services_sale_uq on public.services(sale_id) where sale_id is not null;

-- Historial del caso.
create table public.service_events (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  service_id          uuid not null references public.services(id) on delete cascade,
  kind                text not null check (kind in ('created', 'status', 'assigned', 'note', 'charged', 'charge_voided')),
  from_status         text,
  to_status           text,
  from_user           uuid references public.profiles(id) on delete set null,
  to_user             uuid references public.profiles(id) on delete set null,
  note                text,
  visible_to_customer boolean not null default false,
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_by_name     text,
  -- clock_timestamp y no now(): varios eventos de una misma transacción (cancelar
  -- = quitar piezas + cambiar estado) tienen que quedar en orden.
  created_at          timestamptz not null default clock_timestamp()
);
create index service_events_service_idx on public.service_events(service_id, created_at);

-- ¿Puede el usuario ver este caso? Todos los de su sucursal si tiene "ver todos";
-- si no, los asignados a él, los que recibió y los sin asignar.
create or replace function public.taller_ve_caso(p_branch_id uuid, p_assigned_to uuid, p_received_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_assigned_to is null
      or p_assigned_to = auth.uid()
      or p_received_by = auth.uid()
      or public.taller_tiene_permiso(p_branch_id, 'services-all', 'view');
$$;
revoke execute on function public.taller_ve_caso(uuid, uuid, uuid) from public, anon;
grant execute on function public.taller_ve_caso(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists "Los usuarios pueden ver los servicios de su empresa" on public.services;
drop policy if exists "Los usuarios pueden insertar servicios en su empresa" on public.services;
drop policy if exists "Los usuarios pueden actualizar servicios en su empresa" on public.services;
drop policy if exists "Los usuarios pueden eliminar servicios de su empresa" on public.services;

create policy services_select on public.services
  for select using (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id))
      and public.taller_ve_caso(branch_id, assigned_to, received_by))
    or public.is_super_admin()
  );

create policy services_insert on public.services
  for insert with check (
    (company_id = public.current_company_id()
      and (public.is_company_admin() or branch_id in (select public.user_branch_ids()))
      and public.taller_tiene_permiso(branch_id, 'services', 'create'))
    or public.is_super_admin()
  );

create policy services_update on public.services
  for update using (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id))
      and public.taller_ve_caso(branch_id, assigned_to, received_by)
      and public.taller_tiene_permiso(branch_id, 'services', 'edit'))
    or public.is_super_admin()
  )
  -- Sin la visibilidad: un técnico que pasa su caso a otro deja de verlo, y eso
  -- no tiene que impedir el cambio.
  with check (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id))
      and public.taller_tiene_permiso(branch_id, 'services', 'edit'))
    or public.is_super_admin()
  );

create policy services_delete on public.services
  for delete using (
    (company_id = public.current_company_id()
      and (public.is_company_admin() or branch_id in (select public.user_branch_ids()))
      and public.taller_tiene_permiso(branch_id, 'services', 'delete'))
    or public.is_super_admin()
  );

alter table public.service_events enable row level security;

-- Ver el historial = ver el caso (la subconsulta hereda la RLS de services).
create policy service_events_select on public.service_events
  for select using (exists (select 1 from public.services s where s.id = service_events.service_id));

-- Los usuarios solo escriben notas, y a su nombre. El resto lo escriben los triggers.
create policy service_events_insert_note on public.service_events
  for insert with check (
    kind = 'note'
    and created_by = auth.uid()
    and exists (select 1 from public.services s where s.id = service_events.service_id and s.company_id = service_events.company_id)
  );

grant select, insert on public.service_events to authenticated;
grant select, insert, update, delete on public.service_events to service_role;

-- Antes de crear: número consecutivo por empresa y quién lo recibió.
create or replace function public.taller_before_insert_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Dos ingresos a la vez en la misma empresa esperan uno por el otro: así el
  -- max()+1 no reparte el mismo número dos veces.
  perform pg_advisory_xact_lock(hashtextextended('taller_numero:' || new.company_id::text, 0));
  select coalesce(max(number), 0) + 1 into new.number
    from public.services where company_id = new.company_id;

  new.received_by := coalesce(new.received_by, auth.uid());
  if new.received_by_name is null and new.received_by is not null then
    select name into new.received_by_name from public.profiles where id = new.received_by;
  end if;

  if new.status in ('delivered', 'cancelled') then
    raise exception 'Un caso nuevo no puede entrar entregado ni cancelado.';
  end if;
  if new.sale_id is not null or coalesce(new.payment_status, 'pending') <> 'pending' then
    raise exception 'Un caso nuevo entra por cobrar.';
  end if;

  new.amount_paid := 0;
  new.status_changed_at := now();
  if new.status in ('ready', 'not_repaired') then
    new.ready_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_taller_before_insert_service
  before insert on public.services
  for each row execute function public.taller_before_insert_service();

-- Antes de actualizar: lo que no se puede tocar a mano.
create or replace function public.taller_before_update_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is distinct from old.number or new.company_id is distinct from old.company_id
     or new.branch_id is distinct from old.branch_id then
    raise exception 'No se puede cambiar el número, la empresa ni la sucursal de un caso.';
  end if;

  -- El cobro lo escriben create_sale_with_items y annul_sale, nadie más.
  if (new.sale_id is distinct from old.sale_id
      or new.payment_status is distinct from old.payment_status
      or new.amount_paid is distinct from old.amount_paid)
     and coalesce(current_setting('taller.cobro', true), '') <> 'si' then
    raise exception 'El cobro de un caso se hace desde el POS.';
  end if;

  -- Los importes los calcula el trigger de las líneas (que corre anidado).
  if (new.labor_price is distinct from old.labor_price or new.parts_total is distinct from old.parts_total)
     and pg_trigger_depth() < 2 then
    raise exception 'Los importes del caso salen de sus líneas.';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'El caso #% ya está %.', old.number,
        case old.status when 'delivered' then 'entregado' else 'cancelado' end;
    end if;
    if new.status = 'delivered' and coalesce(current_setting('taller.entregar', true), '') <> 'si' then
      raise exception 'Para entregar un caso usa el botón Entregar.';
    end if;
    if new.status = 'cancelled' then
      if new.sale_id is not null then
        raise exception 'El caso #% ya fue cobrado: anula la venta antes de cancelarlo.', old.number;
      end if;
      if exists (select 1 from public.service_items where service_id = new.id and kind = 'part') then
        raise exception 'Quita las piezas del caso #% antes de cancelarlo (vuelven al inventario).', old.number;
      end if;
    end if;
    new.status_changed_at := now();
    if new.status in ('ready', 'not_repaired') and old.ready_at is null then
      new.ready_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_taller_before_update_service
  before update on public.services
  for each row execute function public.taller_before_update_service();

create or replace function public.taller_before_delete_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.sale_id is not null then
    raise exception 'El caso #% ya fue cobrado: no se puede borrar.', old.number;
  end if;
  return old;
end;
$$;

create trigger trg_taller_before_delete_service
  before delete on public.services
  for each row execute function public.taller_before_delete_service();

-- Historial automático: creación, estado, técnico y cobro. La nota opcional
-- llega por set_config('taller.nota', …) desde las RPC de abajo y se usa una vez.
create or replace function public.taller_after_service_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nota    text := nullif(btrim(coalesce(current_setting('taller.nota', true), '')), '');
  v_visible boolean := coalesce(current_setting('taller.nota_visible', true), '') = 'si';
  v_nombre  text;
begin
  select name into v_nombre from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.service_events
      (company_id, service_id, kind, to_status, to_user, note, created_by, created_by_name)
    values
      (new.company_id, new.id, 'created', new.status, new.assigned_to, v_nota, auth.uid(), v_nombre);
    perform set_config('taller.nota', '', true);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.service_events
      (company_id, service_id, kind, from_status, to_status, note, visible_to_customer, created_by, created_by_name)
    values
      (new.company_id, new.id, 'status', old.status, new.status, v_nota, v_visible and v_nota is not null,
       auth.uid(), v_nombre);
    v_nota := null;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.service_events
      (company_id, service_id, kind, from_user, to_user, note, created_by, created_by_name)
    values
      (new.company_id, new.id, 'assigned', old.assigned_to, new.assigned_to, v_nota, auth.uid(), v_nombre);
    v_nota := null;
  end if;

  if new.sale_id is distinct from old.sale_id then
    insert into public.service_events
      (company_id, service_id, kind, note, created_by, created_by_name)
    values
      (new.company_id, new.id, case when new.sale_id is null then 'charge_voided' else 'charged' end,
       null, auth.uid(), v_nombre);
  end if;

  perform set_config('taller.nota', '', true);
  return null;
end;
$$;

create trigger trg_taller_after_service_event
  after insert or update on public.services
  for each row execute function public.taller_after_service_event();

-- -----------------------------------------------------------------------------
-- 4. Líneas del caso (service_items)
-- -----------------------------------------------------------------------------

alter table public.service_items
  add column kind            text not null default 'part' check (kind in ('labor', 'part')),
  add column service_type_id uuid references public.service_types(id) on delete set null;

-- El trigger viejo descontaba sin mirar empresa ni existencias y sumaba todo a
-- "repuestos". Se reemplaza por dos: validar/mover stock antes, recalcular después.
drop trigger if exists trg_service_item_stock on public.service_items;
drop function if exists public.handle_service_item_stock();

create or replace function public.taller_service_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_srv  public.services%rowtype;
  v_prod public.products%rowtype;
  v_sid  uuid := coalesce(new.service_id, old.service_id);
  v_diff numeric;
begin
  select * into v_srv from public.services where id = v_sid for update;

  if not found then
    -- Borrado en cascada del caso: la pieza vuelve al inventario y listo.
    if tg_op = 'DELETE' and old.kind = 'part' then
      update public.products set stock = stock + old.quantity
       where id = old.product_id and tracks_stock;
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_srv.sale_id is not null then
    raise exception 'El caso #% ya fue cobrado: no se pueden cambiar sus líneas.', v_srv.number;
  end if;
  if v_srv.status in ('delivered', 'cancelled') then
    raise exception 'El caso #% está cerrado.', v_srv.number;
  end if;

  if tg_op = 'DELETE' then
    if old.kind = 'part' then
      update public.products set stock = stock + old.quantity
       where id = old.product_id and tracks_stock;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.product_id is distinct from old.product_id
                           or new.service_id is distinct from old.service_id
                           or new.kind is distinct from old.kind) then
    raise exception 'Para cambiar el artículo de una línea, quítala y agrégala de nuevo.';
  end if;

  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'La cantidad tiene que ser mayor que cero.';
  end if;
  if new.price is null or new.price < 0 then
    raise exception 'El precio no puede ser negativo.';
  end if;

  -- El artículo tiene que ser de la misma sucursal del caso: sin esto, una línea
  -- podía descontar el stock de cualquier producto de cualquier empresa.
  select * into v_prod from public.products
   where id = new.product_id and company_id = v_srv.company_id and branch_id = v_srv.branch_id;
  if not found then
    raise exception 'El artículo no es de la sucursal de este caso.';
  end if;

  new.cost := v_prod.cost;

  if new.kind = 'part' and v_prod.tracks_stock then
    v_diff := case when tg_op = 'INSERT' then new.quantity else new.quantity - old.quantity end;
    if v_diff > 0 then
      update public.products set stock = stock - v_diff
       where id = v_prod.id and stock >= v_diff;
      if not found then
        raise exception 'No hay suficiente «%» (quedan %).', v_prod.name, trim(to_char(v_prod.stock, 'FM999999990.###'));
      end if;
    elsif v_diff < 0 then
      update public.products set stock = stock - v_diff where id = v_prod.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_taller_service_item_guard
  before insert or update or delete on public.service_items
  for each row execute function public.taller_service_item_guard();

create or replace function public.taller_service_item_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := coalesce(new.service_id, old.service_id);
begin
  update public.services s
     set labor_price = t.labor, parts_total = t.parts
    from (
      select coalesce(sum(price * quantity) filter (where kind = 'labor'), 0) as labor,
             coalesce(sum(price * quantity) filter (where kind = 'part'), 0) as parts
        from public.service_items where service_id = v_sid
    ) t
   where s.id = v_sid;
  return null;
end;
$$;

create trigger trg_taller_service_item_totals
  after insert or update or delete on public.service_items
  for each row execute function public.taller_service_item_totals();

-- Ver / tocar líneas = ver / tocar el caso (la subconsulta hereda la RLS).
drop policy if exists "Los usuarios pueden ver los items de sus servicios" on public.service_items;
drop policy if exists "Los usuarios pueden insertar items en sus servicios" on public.service_items;
drop policy if exists "Los usuarios pueden actualizar items en sus servicios" on public.service_items;
drop policy if exists "Los usuarios pueden eliminar items de sus servicios" on public.service_items;

create policy service_items_select on public.service_items
  for select using (exists (select 1 from public.services s where s.id = service_items.service_id));

create policy service_items_write on public.service_items
  for all using (exists (
    select 1 from public.services s
     where s.id = service_items.service_id
       and (public.taller_tiene_permiso(s.branch_id, 'services', 'edit')
            or public.taller_tiene_permiso(s.branch_id, 'services', 'create'))
  ))
  with check (exists (
    select 1 from public.services s
     where s.id = service_items.service_id
       and (public.taller_tiene_permiso(s.branch_id, 'services', 'edit')
            or public.taller_tiene_permiso(s.branch_id, 'services', 'create'))
  ));

-- -----------------------------------------------------------------------------
-- 5. Acciones del caso (RPC). Corren con los permisos de quien llama: la RLS
--    de services decide si puede.
-- -----------------------------------------------------------------------------

create or replace function public.taller_cambiar_estado(
  p_service_id uuid, p_status text, p_note text default null, p_visible boolean default false)
returns public.services
language plpgsql
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
begin
  if p_status = 'delivered' then
    raise exception 'Para entregar un caso usa el botón Entregar.';
  end if;

  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Caso no encontrado.';
  end if;

  if p_status = 'cancelled' then
    if not public.taller_tiene_permiso(v_srv.branch_id, 'services', 'delete') then
      raise exception 'Tu rol no permite cancelar casos del taller.';
    end if;
    -- Las piezas vuelven al inventario (el trigger de las líneas las repone).
    delete from public.service_items where service_id = p_service_id and kind = 'part';
  end if;

  perform set_config('taller.nota', coalesce(p_note, ''), true);
  perform set_config('taller.nota_visible', case when p_visible then 'si' else 'no' end, true);

  update public.services set status = p_status where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para cambiar este caso.';
  end if;
  select * into v_srv from public.services where id = p_service_id;
  return v_srv;
end;
$$;

-- No devuelve el caso: si un técnico se lo pasa a otro, deja de verlo.
create or replace function public.taller_asignar(
  p_service_id uuid, p_profile_id uuid, p_note text default null)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Caso no encontrado.';
  end if;

  if p_profile_id is not null and not exists (
    select 1 from public.service_technicians
     where branch_id = v_srv.branch_id and profile_id = p_profile_id
  ) then
    raise exception 'Esa persona no está en la lista de técnicos de esta sucursal.';
  end if;

  perform set_config('taller.nota', coalesce(p_note, ''), true);

  update public.services set assigned_to = p_profile_id where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para cambiar este caso.';
  end if;
end;
$$;

create or replace function public.taller_entregar(
  p_service_id uuid, p_picked_up_by text default null, p_note text default null)
returns public.services
language plpgsql
set search_path = public
as $$
declare
  v_srv    public.services%rowtype;
  v_nombre text;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Caso no encontrado.';
  end if;
  if v_srv.status not in ('ready', 'not_repaired') then
    raise exception 'El caso #% no está listo para entregar.', v_srv.number;
  end if;
  if v_srv.sale_id is null and coalesce(v_srv.total, 0) > 0 then
    raise exception 'El caso #% tiene RD$% por cobrar: cóbralo en el POS antes de entregarlo.',
      v_srv.number, to_char(v_srv.total, 'FM999,999,990.00');
  end if;

  select name into v_nombre from public.profiles where id = auth.uid();

  perform set_config('taller.entregar', 'si', true);
  perform set_config('taller.nota', coalesce(p_note, ''), true);

  update public.services
     set status = 'delivered',
         delivered_at = now(),
         delivered_by = auth.uid(),
         delivered_by_name = v_nombre,
         picked_up_by_name = nullif(btrim(coalesce(p_picked_up_by, '')), ''),
         outcome = case when v_srv.status = 'not_repaired' then 'not_repaired' else 'repaired' end,
         completed_at = coalesce(completed_at, now())
   where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para entregar este caso.';
  end if;

  perform set_config('taller.entregar', '', true);
  select * into v_srv from public.services where id = p_service_id;
  return v_srv;
end;
$$;

create or replace function public.taller_nota(
  p_service_id uuid, p_note text, p_visible boolean default false)
returns public.service_events
language plpgsql
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
  v_ev  public.service_events%rowtype;
begin
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'Escribe la nota.';
  end if;
  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Caso no encontrado.';
  end if;
  insert into public.service_events
    (company_id, service_id, kind, note, visible_to_customer, created_by, created_by_name)
  values
    (v_srv.company_id, v_srv.id, 'note', btrim(p_note), coalesce(p_visible, false), auth.uid(),
     (select name from public.profiles where id = auth.uid()))
  returning * into v_ev;
  return v_ev;
end;
$$;

-- Guarda un servicio del catálogo con su artículo de servicio, en un solo paso.
-- p: { id?, branch_id, name, price, itbis, description?, equipment_type_id?,
--      part_category_id?, warranty_days?, is_active?, position? }
create or replace function public.taller_guardar_servicio(p jsonb)
returns public.service_types
language plpgsql
set search_path = public
as $$
declare
  v_st     public.service_types%rowtype;
  v_branch uuid := nullif(p->>'branch_id', '')::uuid;
  v_name   text := btrim(coalesce(p->>'name', ''));
  v_price  numeric := coalesce((p->>'price')::numeric, 0);
  v_itbis  boolean := coalesce((p->>'itbis')::boolean, false);
  v_prod   uuid;
begin
  if v_name = '' then
    raise exception 'Escribe el nombre del servicio.';
  end if;
  if v_price < 0 then
    raise exception 'El precio no puede ser negativo.';
  end if;
  if not public.taller_puede_configurar() then
    raise exception 'Tu rol no permite configurar el taller.';
  end if;

  if nullif(p->>'id', '') is not null then
    select * into v_st from public.service_types where id = (p->>'id')::uuid for update;
    if not found then
      raise exception 'Servicio no encontrado.';
    end if;
    v_branch := coalesce(v_st.branch_id, v_branch);
  end if;

  if v_branch is null then
    raise exception 'Falta la sucursal del servicio.';
  end if;

  v_prod := v_st.product_id;
  if v_prod is not null and exists (select 1 from public.products where id = v_prod) then
    update public.products
       set name = v_name, price = v_price, itbis = v_itbis, is_active = coalesce((p->>'is_active')::boolean, true)
     where id = v_prod;
  else
    insert into public.products
      (company_id, branch_id, name, price, cost, itbis, stock, tracks_stock, es_servicio, unit)
    values
      (public.current_company_id(), v_branch, v_name, v_price, 0, v_itbis, 0, false, true, 'und')
    returning id into v_prod;
  end if;

  if v_st.id is null then
    insert into public.service_types
      (company_id, branch_id, product_id, name, description, base_price, equipment_type_id,
       part_category_id, warranty_days, is_active, position)
    values
      (public.current_company_id(), v_branch, v_prod, v_name, nullif(btrim(coalesce(p->>'description', '')), ''),
       v_price, nullif(p->>'equipment_type_id', '')::uuid, nullif(p->>'part_category_id', '')::uuid,
       nullif(p->>'warranty_days', '')::integer, coalesce((p->>'is_active')::boolean, true),
       coalesce((p->>'position')::integer, 0))
    returning * into v_st;
  else
    update public.service_types
       set branch_id = v_branch,
           product_id = v_prod,
           name = v_name,
           description = nullif(btrim(coalesce(p->>'description', '')), ''),
           base_price = v_price,
           equipment_type_id = nullif(p->>'equipment_type_id', '')::uuid,
           part_category_id = nullif(p->>'part_category_id', '')::uuid,
           warranty_days = nullif(p->>'warranty_days', '')::integer,
           is_active = coalesce((p->>'is_active')::boolean, true),
           position = coalesce((p->>'position')::integer, position)
     where id = v_st.id
    returning * into v_st;
  end if;

  return v_st;
end;
$$;

-- Fidelidad: un servicio cuenta cuando se entrega ("completado" ya no existe).
create or replace function public.after_service_loyalty_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null
     and new.status = 'delivered'
     and old.status is distinct from 'delivered'
     and is_module_enabled(new.company_id, 'services', true) then
    perform bump_loyalty_counter(new.customer_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.taller_cambiar_estado(uuid, text, text, boolean) from public, anon;
revoke execute on function public.taller_asignar(uuid, uuid, text) from public, anon;
revoke execute on function public.taller_entregar(uuid, text, text) from public, anon;
revoke execute on function public.taller_nota(uuid, text, boolean) from public, anon;
revoke execute on function public.taller_guardar_servicio(jsonb) from public, anon;
grant execute on function public.taller_cambiar_estado(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.taller_asignar(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.taller_entregar(uuid, text, text) to authenticated, service_role;
grant execute on function public.taller_nota(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.taller_guardar_servicio(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Cobro por el POS
-- -----------------------------------------------------------------------------

alter table public.sales add column service_id uuid references public.services(id) on delete set null;
alter table public.sale_items add column service_item_id uuid references public.service_items(id) on delete set null;
create index sales_service_idx on public.sales(service_id) where service_id is not null;
create index sale_items_service_item_idx on public.sale_items(service_item_id) where service_item_id is not null;

-- Después de insertar las líneas de una venta: si viene de un caso, comprueba que
-- trae exactamente las líneas del caso y lo marca cobrado. Si algo no cuadra, la
-- venta entera se echa atrás.
create or replace function public.taller_vincular_venta(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_srv  public.services%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return;
  end if;

  if v_sale.service_id is null then
    if exists (select 1 from public.sale_items where sale_id = p_sale_id and service_item_id is not null) then
      raise exception 'Una línea del taller necesita su caso.';
    end if;
    return;
  end if;

  if v_sale.company_id <> public.current_company_id() and not public.is_super_admin() then
    raise exception 'Venta no encontrada.';
  end if;

  select * into v_srv from public.services
   where id = v_sale.service_id and company_id = v_sale.company_id
   for update;
  if not found then
    raise exception 'El caso del taller no existe en esta empresa.';
  end if;
  if v_srv.sale_id is not null then
    raise exception 'El caso #% ya fue cobrado.', v_srv.number;
  end if;
  if v_srv.status = 'cancelled' then
    raise exception 'El caso #% está cancelado.', v_srv.number;
  end if;
  if v_srv.branch_id <> v_sale.branch_id then
    raise exception 'El caso #% es de otra sucursal: cóbralo desde esa sucursal.', v_srv.number;
  end if;
  if not exists (select 1 from public.service_items where service_id = v_srv.id) then
    raise exception 'El caso #% no tiene nada que cobrar.', v_srv.number;
  end if;

  if exists (
    select 1
      from public.sale_items x
      left join public.service_items si on si.id = x.service_item_id and si.service_id = v_srv.id
     where x.sale_id = p_sale_id
       and x.service_item_id is not null
       and (si.id is null or si.product_id is distinct from x.product_id or si.quantity <> x.quantity)
  ) or exists (
    select 1
      from public.service_items si
     where si.service_id = v_srv.id
       and (select count(*) from public.sale_items x
             where x.sale_id = p_sale_id and x.service_item_id = si.id) <> 1
  ) then
    raise exception 'Las líneas del caso #% cambiaron. Vuelve a abrir el cobro desde el taller.', v_srv.number;
  end if;

  perform set_config('taller.cobro', 'si', true);
  update public.services
     set sale_id = p_sale_id, payment_status = 'paid', amount_paid = v_sale.total
   where id = v_srv.id;
  perform set_config('taller.cobro', '', true);
end;
$$;

revoke execute on function public.taller_vincular_venta(uuid) from public, anon;
grant execute on function public.taller_vincular_venta(uuid) to authenticated, service_role;

do $migracion$
declare
  v_def text;
  -- Reemplaza `buscar` por `poner` exigiendo que aparezca exactamente una vez.
  v_veces integer;
begin
  -- 6a. create_sale_with_items --------------------------------------------------
  v_def := pg_get_functiondef('public.create_sale_with_items(jsonb,jsonb)'::regprocedure);
  if md5(v_def) <> '21627661dcf3b87bae9a3048fd8019d9' then
    raise exception 'create_sale_with_items cambió desde que se escribió esta migración (md5 %). Revísala antes de aplicar.', md5(v_def);
  end if;

  v_veces := (length(v_def) - length(replace(v_def, E'quote_id, coupon_id, seller_id\n  ) values (', ''))) / length(E'quote_id, coupon_id, seller_id\n  ) values (');
  if v_veces <> 1 then raise exception 'create_sale_with_items: columnas de sales (% veces)', v_veces; end if;
  v_def := replace(v_def, E'quote_id, coupon_id, seller_id\n  ) values (', E'quote_id, coupon_id, seller_id, service_id\n  ) values (');

  v_veces := (length(v_def) - length(replace(v_def, E'nullif(p_sale->>''seller_id'', '''')::uuid\n  ) returning * into v_sale;', ''))) / length(E'nullif(p_sale->>''seller_id'', '''')::uuid\n  ) returning * into v_sale;');
  if v_veces <> 1 then raise exception 'create_sale_with_items: valores de sales (% veces)', v_veces; end if;
  v_def := replace(v_def, E'nullif(p_sale->>''seller_id'', '''')::uuid\n  ) returning * into v_sale;',
                          E'nullif(p_sale->>''seller_id'', '''')::uuid,\n    nullif(p_sale->>''service_id'', '''')::uuid\n  ) returning * into v_sale;');

  v_veces := (length(v_def) - length(replace(v_def, E'presentation_id uuid, units_per numeric\n    )', ''))) / length(E'presentation_id uuid, units_per numeric\n    )');
  if v_veces <> 1 then raise exception 'create_sale_with_items: recordset (% veces)', v_veces; end if;
  v_def := replace(v_def, E'presentation_id uuid, units_per numeric\n    )', E'presentation_id uuid, units_per numeric, service_item_id uuid\n    )');

  v_veces := (length(v_def) - length(replace(v_def, E'presentation_id, presentation_name, units_per)\n    values (', ''))) / length(E'presentation_id, presentation_name, units_per)\n    values (');
  if v_veces <> 1 then raise exception 'create_sale_with_items: columnas de sale_items (% veces)', v_veces; end if;
  v_def := replace(v_def, E'presentation_id, presentation_name, units_per)\n    values (', E'presentation_id, presentation_name, units_per, service_item_id)\n    values (');

  v_veces := (length(v_def) - length(replace(v_def, E'v_pres_id, v_pres_name, v_units_per\n    );', ''))) / length(E'v_pres_id, v_pres_name, v_units_per\n    );');
  if v_veces <> 1 then raise exception 'create_sale_with_items: valores de sale_items (% veces)', v_veces; end if;
  v_def := replace(v_def, E'v_pres_id, v_pres_name, v_units_per\n    );', E'v_pres_id, v_pres_name, v_units_per, v_item.service_item_id\n    );');

  v_veces := (length(v_def) - length(replace(v_def, E'  end loop;\n\n  return v_sale;\nend;', ''))) / length(E'  end loop;\n\n  return v_sale;\nend;');
  if v_veces <> 1 then raise exception 'create_sale_with_items: final (% veces)', v_veces; end if;
  v_def := replace(v_def, E'  end loop;\n\n  return v_sale;\nend;',
                          E'  end loop;\n\n  -- Venta de un caso del taller: comprueba sus líneas y lo marca cobrado.\n  perform public.taller_vincular_venta(v_sale.id);\n\n  return v_sale;\nend;');

  execute v_def;

  -- 6b. decrement_product_stock_for_sale_item -----------------------------------
  v_def := pg_get_functiondef('public.decrement_product_stock_for_sale_item()'::regprocedure);
  if md5(v_def) <> '2a0a1828a9757bea9254cb091f231f2f' then
    raise exception 'decrement_product_stock_for_sale_item cambió desde que se escribió esta migración (md5 %).', md5(v_def);
  end if;
  v_veces := (length(v_def) - length(replace(v_def, E'begin\r\n  if new.product_id is null then', ''))) / length(E'begin\r\n  if new.product_id is null then');
  if v_veces <> 1 then raise exception 'decrement_product_stock_for_sale_item: inicio (% veces)', v_veces; end if;
  v_def := replace(v_def, E'begin\r\n  if new.product_id is null then',
                          E'begin\r\n  -- Línea de un caso del taller: la pieza salió del inventario al agregarla al\r\n  -- caso. taller_vincular_venta comprueba que la línea sea de verdad del caso.\r\n  if new.service_item_id is not null then\r\n    return new;\r\n  end if;\r\n\r\n  if new.product_id is null then');
  execute v_def;

  -- 6c. annul_sale ---------------------------------------------------------------
  v_def := pg_get_functiondef('public.annul_sale(uuid,text,text)'::regprocedure);
  if md5(v_def) <> '721f2cd248cdb439aeab594e5a88632f' then
    raise exception 'annul_sale cambió desde que se escribió esta migración (md5 %).', md5(v_def);
  end if;
  v_veces := (length(v_def) - length(replace(v_def, E'       and p.tracks_stock\r\n  loop', ''))) / length(E'       and p.tracks_stock\r\n  loop');
  if v_veces <> 1 then raise exception 'annul_sale: reposición (% veces)', v_veces; end if;
  v_def := replace(v_def, E'       and p.tracks_stock\r\n  loop',
                          E'       and p.tracks_stock\r\n       -- Las piezas de un caso del taller siguen en el equipo del cliente.\r\n       and si.service_item_id is null\r\n  loop');

  v_veces := (length(v_def) - length(replace(v_def, E'  update sales set cancelled_at = now() where id = v_sale.id;\r\n', ''))) / length(E'  update sales set cancelled_at = now() where id = v_sale.id;\r\n');
  if v_veces <> 1 then raise exception 'annul_sale: cancelled_at (% veces)', v_veces; end if;
  v_def := replace(v_def, E'  update sales set cancelled_at = now() where id = v_sale.id;\r\n',
                          E'  update sales set cancelled_at = now() where id = v_sale.id;\r\n\r\n  -- El caso del taller vuelve a quedar por cobrar.\r\n  perform set_config(''taller.cobro'', ''si'', true);\r\n  update services set sale_id = null, payment_status = ''pending'', amount_paid = 0\r\n   where sale_id = v_sale.id;\r\n  perform set_config(''taller.cobro'', '''', true);\r\n');
  execute v_def;

  -- 6d. seed_system_roles: los roles nuevos traen el permiso de ver todo el taller.
  v_def := pg_get_functiondef('public.seed_system_roles()'::regprocedure);
  if md5(v_def) <> '34028e0e2b2acdcb62ee039e51920864' then
    raise exception 'seed_system_roles cambió desde que se escribió esta migración (md5 %).', md5(v_def);
  end if;
  v_veces := (length(v_def) - length(replace(v_def, '"services":["view","create","edit","delete"],', ''))) / length('"services":["view","create","edit","delete"],');
  if v_veces <> 1 then raise exception 'seed_system_roles: admin (% veces)', v_veces; end if;
  v_def := replace(v_def, '"services":["view","create","edit","delete"],', '"services":["view","create","edit","delete"],"services-all":["view"],');
  v_veces := (length(v_def) - length(replace(v_def, '"services":["view","create"],', ''))) / length('"services":["view","create"],');
  if v_veces <> 1 then raise exception 'seed_system_roles: cajero (% veces)', v_veces; end if;
  v_def := replace(v_def, '"services":["view","create"],', '"services":["view","create","edit"],"services-all":["view"],');
  execute v_def;
end;
$migracion$;

-- -----------------------------------------------------------------------------
-- 7. Roles existentes: nadie pierde lo que veía.
--    Hasta hoy cualquiera con "Servicios → Ver" veía todas las órdenes, y quien
--    podía crearlas también podía cambiarlas. Se conserva tal cual: los roles que
--    ya tenían esos permisos reciben "ver todos" y "editar". Un rol de técnico
--    nuevo se crea sin "ver todos".
-- -----------------------------------------------------------------------------
update public.roles
   set permissions = permissions || jsonb_build_object('services-all', '["view"]'::jsonb)
 where coalesce(permissions -> 'services', '[]'::jsonb) ? 'view'
   and not (permissions ? 'services-all');

update public.roles
   set permissions = jsonb_set(permissions, '{services}', (permissions -> 'services') || '["edit"]'::jsonb)
 where coalesce(permissions -> 'services', '[]'::jsonb) ? 'create'
   and not ((permissions -> 'services') ? 'edit');

-- -----------------------------------------------------------------------------
-- 8. Tiempo real: la lista del taller se actualiza sola (un caso nuevo le aparece
--    al técnico sin recargar). La RLS sigue mandando sobre qué filas llegan.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'services') then
    alter publication supabase_realtime add table public.services;
  end if;
end;
$$;
