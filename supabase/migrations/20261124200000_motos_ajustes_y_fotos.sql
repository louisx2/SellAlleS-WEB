-- Motopréstamos 2C: ajustes del módulo y fotos de la moto y de la cédula.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 2)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-2c-contrato-config-fotos-portal.md (Task 1)
--
-- Solo crea objetos: no cambia ninguna función viva. Las reglas que usan los
-- ajustes llegan en la migración siguiente.
-- Pruebas: supabase/tests/motos_ajustes.sql

-- 1. Ajustes por empresa ------------------------------------------------------------
-- Sin fila = los valores por defecto (lo de 2A/2B). Los contratos vacíos usan el
-- texto base del front.

create table public.motos_settings (
  company_id            uuid primary key default public.current_company_id() references public.companies(id) on delete cascade,
  -- Matrícula en custodia por defecto al vender a crédito o financiado, al vender
  -- de contado y al prestar.
  custody_financed_sale boolean not null default true,
  custody_cash_sale     boolean not null default false,
  custody_loan          boolean not null default true,
  -- Exigir al menos un garante para prestar o para financiar una moto.
  require_guarantor     boolean not null default false,
  contract_sale         text,
  contract_loan         text,
  updated_at            timestamptz not null default now()
);

alter table public.motos_settings enable row level security;
create policy motos_settings_select on public.motos_settings
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy motos_settings_write on public.motos_settings
  for all using ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin());

-- 2. Fotos ------------------------------------------------------------------------------
-- Rutas: <empresa>/vehiculos/<id>/<uuid>.<ext> y <empresa>/clientes/<id>/<uuid>.<ext>

create table public.vehicle_photos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  path        text not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index vehicle_photos_vehicle_idx on public.vehicle_photos(vehicle_id, created_at);

create table public.customer_photos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        text not null default 'cedula' check (kind in ('cedula', 'otro')),
  path        text not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index customer_photos_customer_idx on public.customer_photos(customer_id, created_at);

alter table public.vehicle_photos enable row level security;
alter table public.customer_photos enable row level security;

-- Ver y agregar = ver la moto (la subconsulta hereda la RLS de vehicles); borrar =
-- poder editar vehículos en su sucursal.
create policy vehicle_photos_select on public.vehicle_photos
  for select using (exists (select 1 from public.vehicles v where v.id = vehicle_photos.vehicle_id));
create policy vehicle_photos_insert on public.vehicle_photos
  for insert with check (
    company_id = public.current_company_id()
    and exists (select 1 from public.vehicles v
                 where v.id = vehicle_photos.vehicle_id and v.company_id = vehicle_photos.company_id));
create policy vehicle_photos_delete on public.vehicle_photos
  for delete using (
    exists (select 1 from public.vehicles v
             where v.id = vehicle_photos.vehicle_id
               and public.motos_tiene_permiso(v.branch_id, 'motos', 'edit')));

-- Como garantes y referencias: lo del cliente que el usuario ve.
create policy customer_photos_all on public.customer_photos
  for all using (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_photos.customer_id and c.company_id = customer_photos.company_id))
    or public.is_super_admin())
  with check (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_photos.customer_id and c.company_id = customer_photos.company_id))
    or public.is_super_admin());

create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.motos_settings
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.vehicle_photos
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.customer_photos
  for each row execute function public.bloquear_si_empresa_suspendida();

-- 3. Bucket privado (como el del Taller) ---------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('motos', 'motos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy motos_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'motos'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );
create policy motos_fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'motos'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );
create policy motos_fotos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'motos'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
  );

-- 4. Grants ------------------------------------------------------------------------------

-- Este proyecto todavía da permisos por defecto a lo nuevo: se quitan primero.
revoke all on public.motos_settings, public.vehicle_photos, public.customer_photos from public, anon, authenticated;
grant select, insert, update, delete on public.motos_settings to authenticated, service_role;
grant select, insert, delete on public.vehicle_photos, public.customer_photos to authenticated;
grant select, insert, update, delete on public.vehicle_photos, public.customer_photos to service_role;
