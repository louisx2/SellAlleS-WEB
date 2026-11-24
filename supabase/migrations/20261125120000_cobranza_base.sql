-- Motopréstamos 3A: cobradores, cartera, visitas y entregas.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 3)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-3a-cobranza-y-cuadre.md (Task 1)
--
-- Solo crea objetos y agrega columnas con default (loan_payments y credit_payments);
-- no cambia ninguna función viva. El cobro y el cuadre llegan en la migración
-- siguiente.
-- Pruebas: supabase/tests/cobranza.sql

-- 1. Permisos de cobranza ---------------------------------------------------------------
-- Como motos_tiene_permiso, pero sin permisos por defecto para una fila sin rol:
-- quien no tiene un rol con cobranza no cobra en la calle.

create or replace function public.cobranza_tengo_permiso(p_branch_id uuid, p_resource text, p_action text)
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
       and pb.branch_id = p_branch_id
       and pb.company_id = public.current_company_id()
       and coalesce(r.permissions -> p_resource, '[]'::jsonb) ? p_action
  );
$$;

-- 2. Cobradores (como los técnicos del Taller) ----------------------------------------

create table public.collectors (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Índice y no restricción: una FK doble a branches/profiles como restricción única
-- crearía otra relación para los embeds de PostgREST.
create unique index collectors_branch_profile_uq on public.collectors(branch_id, profile_id);

-- El registro de cobrador del usuario en una sucursal (o null).
create or replace function public.cobranza_mi_cobrador(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.collectors c
   where c.branch_id = p_branch_id and c.profile_id = auth.uid() and c.is_active
     and c.company_id = public.current_company_id();
$$;

-- 3. Cartera: cada cliente con un cobrador por sucursal --------------------------------

create table public.collection_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  collector_id uuid not null references public.collectors(id) on delete cascade,
  visit_order  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index collection_assignments_branch_customer_uq on public.collection_assignments(branch_id, customer_id);
create index collection_assignments_collector_idx on public.collection_assignments(collector_id, visit_order);

-- 4. Visitas ------------------------------------------------------------------------------

create table public.collection_visits (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id       uuid not null references public.branches(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  collector_id    uuid references public.collectors(id) on delete set null,
  outcome         text not null check (outcome in ('pago', 'no_estaba', 'no_tenia', 'promesa', 'se_nego', 'moto_no_aparece')),
  promise_date    date,
  promise_amount  numeric(14,2) check (promise_amount is null or promise_amount > 0),
  note            text,
  payment_id      uuid,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default clock_timestamp(),
  constraint collection_visits_promesa_check check (outcome <> 'promesa' or promise_date is not null)
);
create index collection_visits_customer_idx on public.collection_visits(branch_id, customer_id, created_at);
create index collection_visits_promesas_idx on public.collection_visits(branch_id, promise_date) where outcome = 'promesa';

-- 5. Entregas del cobrador ------------------------------------------------------------------

create table public.collector_settlements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id        uuid not null references public.branches(id) on delete cascade,
  collector_id     uuid not null references public.collectors(id) on delete cascade,
  expected         numeric(14,2) not null,
  received         numeric(14,2) not null check (received >= 0),
  difference       numeric(14,2) generated always as (received - expected) stored,
  note             text,
  caja_movement_id uuid references public.caja_movements(id) on delete set null,
  received_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  received_by_name text,
  created_at       timestamptz not null default now()
);
create index collector_settlements_collector_idx on public.collector_settlements(collector_id, created_at);

-- 6. Abonos en la calle ------------------------------------------------------------------------
-- en_calle: efectivo en el bolsillo del cobrador hasta la entrega (settlement_id).

alter table public.loan_payments
  add column collector_id  uuid references public.collectors(id) on delete set null,
  add column en_calle      boolean not null default false,
  add column settlement_id uuid references public.collector_settlements(id) on delete set null;
alter table public.credit_payments
  add column collector_id  uuid references public.collectors(id) on delete set null,
  add column en_calle      boolean not null default false,
  add column settlement_id uuid references public.collector_settlements(id) on delete set null;
create index loan_payments_en_mano_idx on public.loan_payments(collector_id) where en_calle and settlement_id is null;
create index credit_payments_en_mano_idx on public.credit_payments(collector_id) where en_calle and settlement_id is null;

-- 7. Empresa suspendida y RLS --------------------------------------------------------------------

create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.collectors
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.collection_assignments
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.collection_visits
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.collector_settlements
  for each row execute function public.bloquear_si_empresa_suspendida();

alter table public.collectors enable row level security;
alter table public.collection_assignments enable row level security;
alter table public.collection_visits enable row level security;
alter table public.collector_settlements enable row level security;

create policy collectors_select on public.collectors
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy collectors_write on public.collectors
  for all using ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin())
  with check ((company_id = public.current_company_id() and public.motos_puede_configurar()) or public.is_super_admin());

-- Mi cartera, o todas con cobranza-all; asignar = cobranza-all.
create policy collection_assignments_select on public.collection_assignments
  for select using (
    (company_id = public.current_company_id()
     and (collector_id = public.cobranza_mi_cobrador(branch_id)
          or public.cobranza_tengo_permiso(branch_id, 'cobranza-all', 'view')))
    or public.is_super_admin());
create policy collection_assignments_write on public.collection_assignments
  for all using (
    (company_id = public.current_company_id() and public.cobranza_tengo_permiso(branch_id, 'cobranza-all', 'view'))
    or public.is_super_admin())
  with check (
    (company_id = public.current_company_id() and public.cobranza_tengo_permiso(branch_id, 'cobranza-all', 'view')
     and exists (select 1 from public.collectors c
                  where c.id = collection_assignments.collector_id and c.branch_id = collection_assignments.branch_id))
    or public.is_super_admin());

-- Visitas: las mías o todas con cobranza-all; se escriben por la RPC de la ruta.
create policy collection_visits_select on public.collection_visits
  for select using (
    (company_id = public.current_company_id()
     and (collector_id = public.cobranza_mi_cobrador(branch_id)
          or public.cobranza_tengo_permiso(branch_id, 'cobranza-all', 'view')))
    or public.is_super_admin());

-- Entregas: las mías, o todas con cobranza-cuadre; se escriben por la RPC.
create policy collector_settlements_select on public.collector_settlements
  for select using (
    (company_id = public.current_company_id()
     and (collector_id = public.cobranza_mi_cobrador(branch_id)
          or public.cobranza_tengo_permiso(branch_id, 'cobranza-cuadre', 'view')))
    or public.is_super_admin());

-- 8. Rol Cobrador: se crea al encender el módulo -------------------------------------------------

create or replace function public.cobranza_rol_cobrador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.module_key = 'motoprestamos' and new.enabled then
    insert into public.roles (company_id, name, key, is_system, description, permissions)
    values (new.company_id, 'Cobrador', 'cobrador', true, 'Cobra en la calle a los clientes de su ruta.',
            '{"cobranza":["view","create"],"customers":["view"]}'::jsonb)
    on conflict (company_id, key) where key is not null do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_cobranza_rol_cobrador after insert or update of enabled on public.company_modules
  for each row execute function public.cobranza_rol_cobrador();

-- Las empresas que ya tienen el módulo encendido.
insert into public.roles (company_id, name, key, is_system, description, permissions)
select cm.company_id, 'Cobrador', 'cobrador', true, 'Cobra en la calle a los clientes de su ruta.',
       '{"cobranza":["view","create"],"customers":["view"]}'::jsonb
  from public.company_modules cm
 where cm.module_key = 'motoprestamos' and cm.enabled
on conflict (company_id, key) where key is not null do nothing;

-- 9. Grants ----------------------------------------------------------------------------------------

revoke all on public.collectors, public.collection_assignments, public.collection_visits, public.collector_settlements
  from public, anon, authenticated;
grant select, insert, update, delete on public.collectors, public.collection_assignments to authenticated;
grant select on public.collection_visits, public.collector_settlements to authenticated;
grant select, insert, update, delete on public.collectors, public.collection_assignments, public.collection_visits,
  public.collector_settlements to service_role;

revoke execute on function public.cobranza_tengo_permiso(uuid, text, text) from public, anon;
revoke execute on function public.cobranza_mi_cobrador(uuid) from public, anon;
revoke execute on function public.cobranza_rol_cobrador() from public, anon, authenticated;
grant execute on function public.cobranza_tengo_permiso(uuid, text, text) to authenticated, service_role;
grant execute on function public.cobranza_mi_cobrador(uuid) to authenticated, service_role;
grant execute on function public.cobranza_rol_cobrador() to service_role;
