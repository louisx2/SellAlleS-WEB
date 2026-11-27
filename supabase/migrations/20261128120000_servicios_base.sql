-- =============================================================================
-- Servicios (entrega 1): el Taller pasa a ser un módulo de servicios para
-- cualquier negocio. Diseño: docs/superpowers/specs/2026-11-26-servicios-design.md
--
-- Lo que hace:
--   1. Personal de servicios por sucursal (`service_staff`), con usuario opcional:
--      quien no tiene usuario no gasta cupo.
--   2. Varias personas por línea de servicio (`service_item_staff`).
--   3. Fichas guardadas del cliente (`customer_subjects`): el mismo perro o la
--      misma moto vuelve y no se llena la ficha cada vez.
--   4. El camino de la orden: `stays_in_shop` (se queda en el negocio o no),
--      `is_repair` (copia del tipo de ficha), a domicilio, responsable
--      (`staff_id`) y la ficha usada (`subject_id`).
--   5. Tipos de ficha con nombres de campos, «se deja en el negocio» y «de
--      reparación»; catálogo con duración, comisión, «volver cada» y a domicilio
--      por defecto; «usar un artículo que ya existe».
--   6. Visibilidad por persona: sin «ver todas», cada quien ve las órdenes donde
--      es responsable o está en una línea, las que recibió y las sin asignar.
--   7. Servicios deja de estar encendido por defecto (la fidelidad lo lee con
--      false); la demo recibe su fila para no perderlo.
--
-- Nada se borra: `assigned_to`, `service_technicians`, `taller_asignar` y
-- `taller_ve_caso` quedan sin uso para que el front viejo siga funcionando entre
-- aplicar esto y desplegar. La limpieza va después, aparte.
--
-- Siete funciones vivas se reemplazan partiendo de su pg_get_functiondef. Antes
-- de tocar nada se comprueba la huella md5 de cada una: si alguien la cambió
-- desde que se escribió esta migración, falla sin tocar nada. Huellas tomadas en
-- producción el 2026-11-27:
--   taller_entregar(uuid,text,text)                 8e19bb54e06f6254f238486fc8fa3f37
--   taller_cambiar_estado(uuid,text,text,boolean)   b1b7e19c439799272a6b0f62861e6cc2
--   taller_before_update_service()                  57b8a9c7112801e3a95958ac10cada68
--   taller_after_service_event()                    3b1a88342ab36e233035219f3e4e59fc
--   taller_guardar_servicio(jsonb)                  3431c92b21005781b831388100cba0e7
--   taller_seguimiento_publico(text)                ceb92f122731278985b1be85a6d037a5
--   after_service_loyalty_effects()                 ed768b2db593fa56e737c52f4e2b1aa1
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Huellas de las funciones vivas que se reemplazan más abajo.
-- -----------------------------------------------------------------------------
do $huellas$
declare
  v_fn record;
  v_md5 text;
begin
  for v_fn in
    select * from (values
      ('public.taller_entregar(uuid,text,text)',               '8e19bb54e06f6254f238486fc8fa3f37'),
      ('public.taller_cambiar_estado(uuid,text,text,boolean)', 'b1b7e19c439799272a6b0f62861e6cc2'),
      ('public.taller_before_update_service()',                '57b8a9c7112801e3a95958ac10cada68'),
      ('public.taller_after_service_event()',                  '3b1a88342ab36e233035219f3e4e59fc'),
      ('public.taller_guardar_servicio(jsonb)',                '3431c92b21005781b831388100cba0e7'),
      ('public.taller_seguimiento_publico(text)',              'ceb92f122731278985b1be85a6d037a5'),
      ('public.after_service_loyalty_effects()',               'ed768b2db593fa56e737c52f4e2b1aa1')
    ) as t(fn, huella)
  loop
    v_md5 := md5(pg_get_functiondef(v_fn.fn::regprocedure));
    if v_md5 <> v_fn.huella then
      raise exception '% cambió desde que se escribió esta migración (md5 %). Revísala antes de aplicar.', v_fn.fn, v_md5;
    end if;
  end loop;
end;
$huellas$;

-- -----------------------------------------------------------------------------
-- 1. Personal de servicios
-- -----------------------------------------------------------------------------

-- Reemplaza a service_technicians (0 filas, queda sin uso). El usuario es
-- opcional: sin él la persona no entra al sistema y la caja le maneja las órdenes.
create table public.service_staff (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  phone           text,
  -- Color en la agenda: #rrggbb.
  color           text check (color ~ '^#[0-9a-fA-F]{6}$'),
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  profile_id      uuid references public.profiles(id) on delete set null,
  is_active       boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);
-- Índice único y NO restricción `unique`: con branch_id y profile_id (las dos con
-- FK) dentro de una clave, PostgREST toma la tabla por puente entre branches y
-- profiles y los embeds que hoy resuelven pasan a responder 300 (incidente de
-- branch_sharing, 2026-07-31).
create unique index service_staff_branch_profile_uq on public.service_staff(branch_id, profile_id) where profile_id is not null;
create index service_staff_branch_idx on public.service_staff(branch_id, position);
create index service_staff_profile_idx on public.service_staff(profile_id) where profile_id is not null;

alter table public.service_staff enable row level security;

-- Ver: la sucursal o su pool de servicios (el administrador, todo). Escribir: quien
-- configura los servicios, y siempre en una sucursal de la misma empresa.
create policy service_staff_select on public.service_staff
  for select using (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id)))
    or public.is_super_admin()
  );
create policy service_staff_write on public.service_staff
  for all using ((company_id = public.current_company_id() and public.taller_puede_configurar()) or public.is_super_admin())
  with check (
    (company_id = public.current_company_id()
      and public.taller_puede_configurar()
      and exists (select 1 from public.branches b
                   where b.id = service_staff.branch_id and b.company_id = service_staff.company_id))
    or public.is_super_admin()
  );

revoke all on table public.service_staff from public, anon, authenticated;
grant select, insert, update, delete on public.service_staff to authenticated;
grant select, insert, update, delete on public.service_staff to service_role;

-- -----------------------------------------------------------------------------
-- 2. Columnas nuevas de lo que ya existe
-- -----------------------------------------------------------------------------

-- Tipo de ficha: cómo se llaman sus campos (null = no lleva), si se deja en el
-- negocio y si es de reparación. Los tipos que ya existen son de taller.
alter table public.service_equipment_types
  alter column serial_label drop not null,
  add column brand_label   text default 'Marca' check (brand_label is null or btrim(brand_label) <> ''),
  add column model_label   text default 'Modelo' check (model_label is null or btrim(model_label) <> ''),
  add column stays_in_shop boolean not null default true,
  add column is_repair     boolean not null default false;
update public.service_equipment_types set is_repair = true;

-- Catálogo: duración, comisión propia (% o monto fijo, nunca los dos; sin ella
-- vale la de la persona), «volver cada» y a domicilio por defecto.
alter table public.service_types
  add column duration_min        integer check (duration_min > 0),
  add column commission_rate     numeric(5,2) check (commission_rate between 0 and 100),
  add column commission_amount   numeric(12,2) check (commission_amount >= 0),
  add column repeat_every_days   integer check (repeat_every_days > 0),
  add column at_customer_default boolean not null default false,
  add constraint service_types_commission_one check (commission_rate is null or commission_amount is null);

alter table public.taller_settings
  add column default_at_customer boolean not null default false;

-- Fichas guardadas del cliente. La orden guarda una copia (equipment_*), así que
-- cambiar la ficha después no cambia órdenes viejas. No se borran: se desactivan.
create table public.customer_subjects (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  customer_id       uuid not null references public.customers(id) on delete cascade,
  equipment_type_id uuid references public.service_equipment_types(id) on delete set null,
  brand             text,
  model             text,
  serial            text,
  details           jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index customer_subjects_customer_idx on public.customer_subjects(customer_id);

create or replace function public.servicios_ficha_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.servicios_ficha_updated_at() from public, anon, authenticated;

create trigger trg_servicios_ficha_updated_at
  before update on public.customer_subjects
  for each row execute function public.servicios_ficha_updated_at();

-- La orden: responsable, el camino y la ficha usada. Los dos `default true` son lo
-- que deja el front viejo (taller de reparación, el equipo se queda).
alter table public.services
  add column staff_id       uuid constraint services_staff_id_fkey references public.service_staff(id) on delete set null,
  add column stays_in_shop  boolean not null default true,
  add column is_repair      boolean not null default true,
  add column at_customer    boolean not null default false,
  add column service_address text,
  add column subject_id     uuid references public.customer_subjects(id) on delete set null;
create index services_staff_idx on public.services(staff_id) where staff_id is not null;
create index services_subject_idx on public.services(subject_id) where subject_id is not null;

-- El historial anota el cambio de responsable con las personas, no con usuarios.
alter table public.service_events
  add column from_staff uuid references public.service_staff(id) on delete set null,
  add column to_staff   uuid references public.service_staff(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Quién hace cada línea de servicio (varias personas por línea)
-- -----------------------------------------------------------------------------

create table public.service_item_staff (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  service_item_id uuid not null references public.service_items(id) on delete cascade,
  staff_id        uuid not null references public.service_staff(id) on delete restrict,
  created_at      timestamptz not null default now()
);
-- Índice único y NO restricción: ver service_staff arriba (tabla puente → 300).
create unique index service_item_staff_item_staff_uq on public.service_item_staff(service_item_id, staff_id);
create index service_item_staff_staff_idx on public.service_item_staff(staff_id);

-- Antes de poner, cambiar o quitar a alguien de una línea: la orden sigue abierta
-- y sin cobrar, la línea es de servicio y la persona está activa en la sucursal
-- de la orden. La empresa sale de la orden.
create or replace function public.servicios_item_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  public.service_items%rowtype;
  v_srv   public.services%rowtype;
  v_staff public.service_staff%rowtype;
begin
  -- Quitar (o mover) a alguien: la orden de la línea vieja tiene que seguir
  -- abierta. Si la línea ya no existe, se está borrando la línea o la orden.
  if tg_op <> 'INSERT' then
    select s.* into v_srv
      from public.service_items si
      join public.services s on s.id = si.service_id
     where si.id = old.service_item_id
       for update of s;
    if found then
      if v_srv.sale_id is not null then
        raise exception 'La orden #% ya fue cobrada: no se pueden cambiar sus líneas.', v_srv.number;
      end if;
      if v_srv.status in ('delivered', 'cancelled') then
        raise exception 'La orden #% está cerrada.', v_srv.number;
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  select * into v_item from public.service_items where id = new.service_item_id;
  if not found then
    raise exception 'Línea no encontrada.';
  end if;
  select * into v_srv from public.services where id = v_item.service_id for update;

  if v_srv.sale_id is not null then
    raise exception 'La orden #% ya fue cobrada: no se pueden cambiar sus líneas.', v_srv.number;
  end if;
  if v_srv.status in ('delivered', 'cancelled') then
    raise exception 'La orden #% está cerrada.', v_srv.number;
  end if;

  if v_item.kind <> 'labor' then
    raise exception 'Solo los servicios llevan quién los hace.';
  end if;

  if tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id then
    select * into v_staff from public.service_staff where id = new.staff_id;
    if not found or not v_staff.is_active or v_staff.branch_id <> v_srv.branch_id then
      raise exception 'Esa persona no está en el personal de esta sucursal.';
    end if;
  end if;

  new.company_id := v_srv.company_id;
  return new;
end;
$$;
revoke all on function public.servicios_item_staff_guard() from public, anon, authenticated;

create trigger trg_servicios_item_staff_guard
  before insert or update or delete on public.service_item_staff
  for each row execute function public.servicios_item_staff_guard();

alter table public.service_item_staff enable row level security;

-- Ver = ver la línea (la subconsulta hereda la RLS de service_items → services).
-- Escribir = ver la orden y poder crear o editar Servicios en su sucursal, igual
-- que service_items_write: quien puede agregar una línea dice quién la hace (al
-- crear la orden, las líneas y sus personas se guardan juntas).
create policy service_item_staff_select on public.service_item_staff
  for select using (exists (select 1 from public.service_items si where si.id = service_item_staff.service_item_id));
create policy service_item_staff_write on public.service_item_staff
  for all using (exists (
    select 1
      from public.service_items si
      join public.services s on s.id = si.service_id
     where si.id = service_item_staff.service_item_id
       and (public.taller_tiene_permiso(s.branch_id, 'services', 'edit')
            or public.taller_tiene_permiso(s.branch_id, 'services', 'create'))
  ))
  with check (exists (
    select 1
      from public.service_items si
      join public.services s on s.id = si.service_id
     where si.id = service_item_staff.service_item_id
       and (public.taller_tiene_permiso(s.branch_id, 'services', 'edit')
            or public.taller_tiene_permiso(s.branch_id, 'services', 'create'))
  ));

revoke all on table public.service_item_staff from public, anon, authenticated;
grant select, insert, update, delete on public.service_item_staff to authenticated;
grant select, insert, update, delete on public.service_item_staff to service_role;

-- -----------------------------------------------------------------------------
-- 4. Quién ve qué
-- -----------------------------------------------------------------------------

-- ¿Puede el usuario ver esta orden? Todas las de su sucursal si tiene «ver
-- todas»; si no, las sin responsable, las que recibió y aquellas donde su
-- persona del personal es la responsable o está en alguna línea.
create or replace function public.servicios_ve_orden(
  p_service_id uuid, p_branch_id uuid, p_staff_id uuid, p_received_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
       p_staff_id is null
    or p_received_by = auth.uid()
    or exists (select 1 from public.service_staff st
                where st.id = p_staff_id and st.profile_id = auth.uid())
    or exists (select 1
                 from public.service_items si
                 join public.service_item_staff sis on sis.service_item_id = si.id
                 join public.service_staff st on st.id = sis.staff_id
                where si.service_id = p_service_id and st.profile_id = auth.uid())
    or public.taller_tiene_permiso(p_branch_id, 'services-all', 'view'),
    false);
$$;

-- ¿Tiene el usuario este permiso de Servicios en alguna de sus sucursales? Para
-- lo que no es de una sucursal (las fichas son del cliente).
create or replace function public.servicios_permiso_en_alguna(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin() or public.is_super_admin() or exists (
    select 1
      from public.profile_branches pb
     where pb.profile_id = auth.uid()
       and pb.company_id = public.current_company_id()
       and public.taller_tiene_permiso(pb.branch_id, 'services', p_action)
  );
$$;

revoke all on function public.servicios_ve_orden(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.servicios_permiso_en_alguna(text) from public, anon, authenticated;
grant execute on function public.servicios_ve_orden(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.servicios_permiso_en_alguna(text) to authenticated, service_role;

-- Solo cambia la visibilidad; el WITH CHECK de services_update queda como está
-- (sin la visibilidad: pasar la orden a otro no tiene que impedir el cambio).
alter policy services_select on public.services
  using (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id))
      and public.servicios_ve_orden(id, branch_id, staff_id, received_by))
    or public.is_super_admin()
  );

alter policy services_update on public.services
  using (
    (company_id = public.current_company_id()
      and (public.is_company_admin()
           or branch_id in (select public.user_branch_ids())
           or public.branch_shares_with_me('servicios', branch_id))
      and public.servicios_ve_orden(id, branch_id, staff_id, received_by)
      and public.taller_tiene_permiso(branch_id, 'services', 'edit'))
    or public.is_super_admin()
  );

-- Fichas: se ven si se ve el cliente; se crean y cambian con Servicios crear o
-- editar en alguna sucursal. Sin política de borrar (y sin grant): se desactivan.
alter table public.customer_subjects enable row level security;

create policy customer_subjects_select on public.customer_subjects
  for select using (exists (
    select 1 from public.customers c
     where c.id = customer_subjects.customer_id and c.company_id = customer_subjects.company_id
  ));
create policy customer_subjects_insert on public.customer_subjects
  for insert with check (
    (company_id = public.current_company_id()
      and exists (select 1 from public.customers c
                   where c.id = customer_subjects.customer_id and c.company_id = customer_subjects.company_id)
      and (public.servicios_permiso_en_alguna('create') or public.servicios_permiso_en_alguna('edit')))
    or public.is_super_admin()
  );
create policy customer_subjects_update on public.customer_subjects
  for update using (
    (company_id = public.current_company_id()
      and exists (select 1 from public.customers c
                   where c.id = customer_subjects.customer_id and c.company_id = customer_subjects.company_id)
      and (public.servicios_permiso_en_alguna('create') or public.servicios_permiso_en_alguna('edit')))
    or public.is_super_admin()
  )
  with check (
    (company_id = public.current_company_id()
      and exists (select 1 from public.customers c
                   where c.id = customer_subjects.customer_id and c.company_id = customer_subjects.company_id)
      and (public.servicios_permiso_en_alguna('create') or public.servicios_permiso_en_alguna('edit')))
    or public.is_super_admin()
  );

revoke all on table public.customer_subjects from public, anon, authenticated;
grant select, insert, update on public.customer_subjects to authenticated;
grant select, insert, update, delete on public.customer_subjects to service_role;

-- -----------------------------------------------------------------------------
-- 5. Pasar la orden a otra persona
-- -----------------------------------------------------------------------------

-- Lo mismo que taller_asignar, con el personal. SECURITY DEFINER porque quien se
-- la pasa a otro deja de verla, y la RLS de UPDATE exige que la fila nueva se vea:
-- la función comprueba ANTES lo mismo que la RLS. No devuelve la orden.
create or replace function public.servicios_asignar(
  p_service_id uuid, p_staff_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_srv public.services%rowtype;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found or not coalesce(
       public.is_super_admin()
       or (v_srv.company_id = public.current_company_id()
           and (public.is_company_admin()
                or v_srv.branch_id in (select public.user_branch_ids())
                or public.branch_shares_with_me('servicios', v_srv.branch_id))
           and public.servicios_ve_orden(v_srv.id, v_srv.branch_id, v_srv.staff_id, v_srv.received_by)),
       false) then
    raise exception 'Orden no encontrada.';
  end if;

  if not public.taller_tiene_permiso(v_srv.branch_id, 'services', 'edit') then
    raise exception 'Tu rol no permite cambiar órdenes de servicio.';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.service_staff
     where id = p_staff_id and branch_id = v_srv.branch_id and is_active
  ) then
    raise exception 'Esa persona no está en el personal de esta sucursal.';
  end if;

  perform set_config('taller.nota', coalesce(p_note, ''), true);
  update public.services set staff_id = p_staff_id where id = p_service_id;
end;
$$;

revoke all on function public.servicios_asignar(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.servicios_asignar(uuid, uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Funciones vivas, cambiadas sobre su definición de producción (huellas
--    comprobadas en el paso 0). `create or replace` conserva sus grants.
-- -----------------------------------------------------------------------------

-- Antes de actualizar: suma que «de reparación» no cambia después de crear la
-- orden, que «El cliente espera» no cambia con la orden Lista ni cerrada, y que
-- una orden que no se queda no pasa a Lista (también por un UPDATE directo).
CREATE OR REPLACE FUNCTION public.taller_before_update_service()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.number is distinct from old.number or new.company_id is distinct from old.company_id
     or new.branch_id is distinct from old.branch_id then
    raise exception 'No se puede cambiar el número, la empresa ni la sucursal de una orden.';
  end if;

  -- Si es de reparación sale del tipo de ficha al crear la orden.
  if new.is_repair is distinct from old.is_repair then
    raise exception 'Si la orden es de reparación se decide al crearla.';
  end if;

  -- «El cliente espera» decide el camino: no se cambia con la orden Lista para
  -- retirar ni cerrada.
  if new.stays_in_shop is distinct from old.stays_in_shop
     and old.status in ('ready', 'delivered', 'cancelled') then
    raise exception 'Pasa la orden a otro estado antes de cambiar si el cliente espera.';
  end if;

  -- El cobro lo escriben create_sale_with_items y annul_sale, nadie más.
  if (new.sale_id is distinct from old.sale_id
      or new.payment_status is distinct from old.payment_status
      or new.amount_paid is distinct from old.amount_paid)
     and coalesce(current_setting('taller.cobro', true), '') <> 'si' then
    raise exception 'El cobro de una orden se hace desde el POS.';
  end if;

  -- Los importes los calcula el trigger de las líneas (que corre anidado).
  if (new.labor_price is distinct from old.labor_price or new.parts_total is distinct from old.parts_total)
     and pg_trigger_depth() < 2 then
    raise exception 'Los importes de la orden salen de sus líneas.';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'La orden #% ya está %.', old.number,
        case old.status when 'delivered' then 'cerrada' else 'cancelada' end;
    end if;
    if new.status = 'delivered' and coalesce(current_setting('taller.entregar', true), '') <> 'si' then
      raise exception 'Para cerrar una orden usa el botón Entregar o Terminar.';
    end if;
    -- Una orden que no se queda no pasa por «Listo para retirar»: se termina.
    if new.status = 'ready' and not new.stays_in_shop then
      raise exception 'Esta orden no se queda en el negocio: termínala cuando acabes.';
    end if;
    if new.status = 'cancelled' then
      if new.sale_id is not null then
        raise exception 'La orden #% ya fue cobrada: anula la venta antes de cancelarla.', old.number;
      end if;
      if exists (select 1 from public.service_items where service_id = new.id and kind = 'part') then
        raise exception 'Quita las piezas y materiales de la orden #% antes de cancelarla (vuelven al inventario).', old.number;
      end if;
    end if;
    new.status_changed_at := now();
    if new.status in ('ready', 'not_repaired') and old.ready_at is null then
      new.ready_at := now();
    end if;
  end if;

  return new;
end;
$function$;

-- Historial: el responsable es una persona del personal (staff_id), ya no un
-- usuario (assigned_to). Si el cambio viene de borrar a la persona (la FK pone
-- null), no es una reasignación y no se anota: su id ya no existe.
CREATE OR REPLACE FUNCTION public.taller_after_service_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nota    text := nullif(btrim(coalesce(current_setting('taller.nota', true), '')), '');
  v_visible boolean := coalesce(current_setting('taller.nota_visible', true), '') = 'si';
  v_nombre  text;
begin
  select name into v_nombre from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.service_events
      (company_id, service_id, kind, to_status, to_staff, note, created_by, created_by_name)
    values
      (new.company_id, new.id, 'created', new.status, new.staff_id, v_nota, auth.uid(), v_nombre);
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

  if new.staff_id is distinct from old.staff_id
     and (new.staff_id is not null
          or exists (select 1 from public.service_staff where id = old.staff_id)) then
    insert into public.service_events
      (company_id, service_id, kind, from_staff, to_staff, note, created_by, created_by_name)
    values
      (new.company_id, new.id, 'assigned', old.staff_id, new.staff_id, v_nota, auth.uid(), v_nombre);
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
$function$;

-- Una orden que no se queda no pasa a «Listo para retirar».
CREATE OR REPLACE FUNCTION public.taller_cambiar_estado(p_service_id uuid, p_status text, p_note text DEFAULT NULL::text, p_visible boolean DEFAULT false)
 RETURNS services
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_srv public.services%rowtype;
begin
  if p_status = 'delivered' then
    raise exception 'Para cerrar una orden usa el botón Entregar o Terminar.';
  end if;

  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Orden no encontrada.';
  end if;

  if p_status = 'ready' and not v_srv.stays_in_shop then
    raise exception 'Esta orden no se queda en el negocio: termínala cuando acabes.';
  end if;

  if p_status = 'cancelled' then
    if not public.taller_tiene_permiso(v_srv.branch_id, 'services', 'delete') then
      raise exception 'Tu rol no permite cancelar órdenes de servicio.';
    end if;
    -- Las piezas vuelven al inventario (el trigger de las líneas las repone).
    delete from public.service_items where service_id = p_service_id and kind = 'part';
  end if;

  perform set_config('taller.nota', coalesce(p_note, ''), true);
  perform set_config('taller.nota_visible', case when p_visible then 'si' else 'no' end, true);

  update public.services set status = p_status where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para cambiar esta orden.';
  end if;
  select * into v_srv from public.services where id = p_service_id;
  return v_srv;
end;
$function$;

-- Entregar / Terminar. La que se queda se entrega desde Lista o No se pudo
-- reparar, como hoy. La que no se queda se termina desde cualquier estado
-- abierto y sin quién retira. La garantía cuenta si no terminó en «no se pudo
-- reparar» (para la que se queda es lo mismo que «desde Lista»).
CREATE OR REPLACE FUNCTION public.taller_entregar(p_service_id uuid, p_picked_up_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS services
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_srv    public.services%rowtype;
  v_nombre text;
  v_dias   integer;
begin
  select * into v_srv from public.services where id = p_service_id;
  if not found then
    raise exception 'Orden no encontrada.';
  end if;
  if v_srv.stays_in_shop then
    if v_srv.status not in ('ready', 'not_repaired') then
      raise exception 'La orden #% no está lista para entregar.', v_srv.number;
    end if;
  elsif v_srv.status in ('delivered', 'cancelled') then
    raise exception 'La orden #% ya está %.', v_srv.number,
      case v_srv.status when 'delivered' then 'cerrada' else 'cancelada' end;
  end if;
  if v_srv.sale_id is null and coalesce(v_srv.total, 0) > 0 then
    raise exception 'La orden #% tiene RD$% por cobrar: cóbrala en el POS antes de cerrarla.',
      v_srv.number, to_char(v_srv.total, 'FM999,999,990.00');
  end if;

  select name into v_nombre from public.profiles where id = auth.uid();

  if v_srv.status <> 'not_repaired' and v_srv.warranty_of_service_id is null and v_srv.warranty_sale_id is null then
    select coalesce(
             (select max(st.warranty_days)
                from public.service_items si
                join public.service_types st on st.id = si.service_type_id
               where si.service_id = v_srv.id and si.kind = 'labor'),
             (select ts.default_warranty_days from public.taller_settings ts where ts.branch_id = v_srv.branch_id))
      into v_dias;
  end if;

  perform set_config('taller.entregar', 'si', true);
  perform set_config('taller.nota', coalesce(p_note, ''), true);

  update public.services
     set status = 'delivered',
         delivered_at = now(),
         delivered_by = auth.uid(),
         delivered_by_name = v_nombre,
         picked_up_by_name = case when v_srv.stays_in_shop
                                  then nullif(btrim(coalesce(p_picked_up_by, '')), '') end,
         outcome = case when v_srv.status = 'not_repaired' then 'not_repaired' else 'repaired' end,
         completed_at = coalesce(completed_at, now()),
         warranty_until = case when coalesce(v_dias, 0) > 0
                               then public.company_today(v_srv.company_id) + v_dias end
   where id = p_service_id;
  if not found then
    raise exception 'No tienes permiso para cerrar esta orden.';
  end if;

  perform set_config('taller.entregar', '', true);
  select * into v_srv from public.services where id = p_service_id;
  return v_srv;
end;
$function$;

-- Guarda un servicio del catálogo con su artículo de servicio, en un solo paso.
-- p: { id?, branch_id, name, price, itbis, description?, equipment_type_id?,
--      part_category_id?, warranty_days?, is_active?, position?, duration_min?,
--      commission_rate?, commission_amount?, repeat_every_days?,
--      at_customer_default?, es_servicio? (true), link_product_id? }
-- link_product_id usa un artículo que ya existe en vez de crear uno, solo si el
-- servicio todavía no tiene artículo: tiene que ser de la sucursal, no ser ya otro
-- servicio y no tener existencias. Pasa a no manejar existencias.
CREATE OR REPLACE FUNCTION public.taller_guardar_servicio(p jsonb)
 RETURNS service_types
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_st       public.service_types%rowtype;
  v_branch   uuid := nullif(p->>'branch_id', '')::uuid;
  v_name     text := btrim(coalesce(p->>'name', ''));
  v_price    numeric := coalesce((p->>'price')::numeric, 0);
  v_itbis    boolean := coalesce((p->>'itbis')::boolean, false);
  v_es_serv  boolean := coalesce((p->>'es_servicio')::boolean, true);
  v_link     uuid := nullif(p->>'link_product_id', '')::uuid;
  v_com_rate numeric := nullif(p->>'commission_rate', '')::numeric;
  v_com_amt  numeric := nullif(p->>'commission_amount', '')::numeric;
  v_prod     uuid;
  v_art      public.products%rowtype;
begin
  if v_name = '' then
    raise exception 'Escribe el nombre del servicio.';
  end if;
  if v_price < 0 then
    raise exception 'El precio no puede ser negativo.';
  end if;
  if v_com_rate is not null and v_com_amt is not null then
    raise exception 'La comisión es un porcentaje o un monto fijo, no los dos.';
  end if;
  if not public.taller_puede_configurar() then
    raise exception 'Tu rol no permite configurar los servicios.';
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

  -- Su artículo, si todavía existe.
  v_prod := v_st.product_id;
  if v_prod is not null and not exists (select 1 from public.products where id = v_prod) then
    v_prod := null;
  end if;

  if v_link is not null and v_link is distinct from v_prod then
    if v_prod is not null then
      raise exception 'Este servicio ya tiene su artículo.';
    end if;
    select * into v_art from public.products
     where id = v_link and company_id = public.current_company_id() and branch_id = v_branch
       for update;
    if not found then
      raise exception 'El artículo no es de esta sucursal.';
    end if;
    if exists (select 1 from public.service_types where product_id = v_link and id is distinct from v_st.id) then
      raise exception 'Ese artículo ya es otro servicio del catálogo.';
    end if;
    if v_art.tracks_stock and v_art.stock > 0 then
      raise exception 'Ese artículo tiene existencias (%). Crea un servicio nuevo y agrega el artículo a la orden como material.',
        trim_scale(v_art.stock);
    end if;
    v_prod := v_link;
    update public.products
       set tracks_stock = false, es_servicio = v_es_serv, name = v_name, price = v_price, itbis = v_itbis,
           is_active = coalesce((p->>'is_active')::boolean, true)
     where id = v_prod;
  elsif v_prod is not null then
    update public.products
       set name = v_name, price = v_price, itbis = v_itbis, es_servicio = v_es_serv,
           is_active = coalesce((p->>'is_active')::boolean, true)
     where id = v_prod;
  else
    insert into public.products
      (company_id, branch_id, name, price, cost, itbis, stock, tracks_stock, es_servicio, unit)
    values
      (public.current_company_id(), v_branch, v_name, v_price, 0, v_itbis, 0, false, v_es_serv, 'und')
    returning id into v_prod;
  end if;

  if v_st.id is null then
    insert into public.service_types
      (company_id, branch_id, product_id, name, description, base_price, equipment_type_id,
       part_category_id, warranty_days, is_active, position, duration_min, commission_rate,
       commission_amount, repeat_every_days, at_customer_default)
    values
      (public.current_company_id(), v_branch, v_prod, v_name, nullif(btrim(coalesce(p->>'description', '')), ''),
       v_price, nullif(p->>'equipment_type_id', '')::uuid, nullif(p->>'part_category_id', '')::uuid,
       nullif(p->>'warranty_days', '')::integer, coalesce((p->>'is_active')::boolean, true),
       coalesce((p->>'position')::integer, 0), nullif(p->>'duration_min', '')::integer, v_com_rate,
       v_com_amt, nullif(p->>'repeat_every_days', '')::integer,
       coalesce((p->>'at_customer_default')::boolean, false))
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
           position = coalesce((p->>'position')::integer, position),
           duration_min = nullif(p->>'duration_min', '')::integer,
           commission_rate = v_com_rate,
           commission_amount = v_com_amt,
           repeat_every_days = nullif(p->>'repeat_every_days', '')::integer,
           at_customer_default = coalesce((p->>'at_customer_default')::boolean, false)
     where id = v_st.id
    returning * into v_st;
  end if;

  return v_st;
end;
$function$;

-- Seguimiento: suma el camino (se queda, de reparación, a domicilio), la ficha y
-- el primer nombre de quien atiende. Sigue sin dar IMEI, clave, notas internas ni
-- la dirección.
CREATE OR REPLACE FUNCTION public.taller_seguimiento_publico(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_srv public.services%rowtype;
  v_res jsonb;
begin
  if p_code is null or length(p_code) <> 10 then
    return null;
  end if;

  select * into v_srv from public.services where tracking_code = p_code;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'negocio', jsonb_build_object(
      'nombre', coalesce(nullif(btrim(b.display_name), ''), c.name),
      'telefono', coalesce(nullif(btrim(b.phone), ''), c.phone),
      'direccion', coalesce(nullif(btrim(b.address), ''), c.address),
      'logo', coalesce(b.ticket_logo_url, b.logo_url, c.ticket_logo_url, c.logo_url)
    ),
    'caso', jsonb_build_object(
      'numero', v_srv.number,
      'estado', v_srv.status,
      'equipo', nullif(btrim(concat_ws(' ', v_srv.equipment_brand, v_srv.equipment_model)), ''),
      'tipo_equipo', (select name from public.service_equipment_types where id = v_srv.equipment_type_id),
      'cliente', split_part(coalesce(cu.name, v_srv.brought_by_name, ''), ' ', 1),
      'ingreso', v_srv.created_at,
      'prometido', v_srv.promised_at,
      'listo', v_srv.ready_at,
      'entregado', v_srv.delivered_at,
      'total', v_srv.total,
      'cobrado', v_srv.payment_status = 'paid',
      'garantia_hasta', v_srv.warranty_until,
      'se_queda', v_srv.stays_in_shop,
      'reparacion', v_srv.is_repair,
      'a_domicilio', v_srv.at_customer,
      'ficha', nullif(btrim(concat_ws(' ', v_srv.equipment_brand, v_srv.equipment_model)), ''),
      'atiende', (select nullif(split_part(btrim(st.name), ' ', 1), '')
                    from public.service_staff st where st.id = v_srv.staff_id)
    ),
    -- Las notas de los cambios de estado solo salen si se marcaron para el cliente.
    'avance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'estado', e.to_status,
               'nota', case when e.visible_to_customer then e.note end,
               'fecha', e.created_at) order by e.created_at)
        from public.service_events e
       where e.service_id = v_srv.id and e.kind in ('created', 'status')
    ), '[]'::jsonb),
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object('nota', e.note, 'fecha', e.created_at) order by e.created_at)
        from public.service_events e
       where e.service_id = v_srv.id and e.kind = 'note' and e.visible_to_customer
    ), '[]'::jsonb)
  ) into v_res
  from public.branches b
  join public.companies c on c.id = b.company_id
  left join public.customers cu on cu.id = v_srv.customer_id
  where b.id = v_srv.branch_id;

  return v_res;
end;
$function$;

-- Fidelidad: Servicios ya no está encendido por defecto.
CREATE OR REPLACE FUNCTION public.after_service_loyalty_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.customer_id is not null
     and new.status = 'delivered'
     and old.status is distinct from 'delivered'
     and is_module_enabled(new.company_id, 'services', false) then
    perform bump_loyalty_counter(new.customer_id);
  end if;
  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 7. La demo no tiene fila de Servicios y lo tenía por defecto: no lo pierde.
-- -----------------------------------------------------------------------------
insert into public.company_modules (company_id, module_key, enabled)
values ('00000000-0000-0000-0000-0000000000aa', 'services', true)
on conflict do nothing;
