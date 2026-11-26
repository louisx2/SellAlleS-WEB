-- Motopréstamos 2B: datos del cliente para este negocio.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 2, "Datos del cliente")
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-2b-garantia-matriculas.md (Task 1)
--
-- Solo agrega columnas nulas a `customers` y crea dos tablas; no cambia ninguna
-- función viva. Garantes y referencias van por cliente, no por operación.
-- Pruebas: supabase/tests/motos_clientes.sql

-- 1. Datos de cobranza en el cliente ----------------------------------------------

alter table public.customers
  add column nickname             text,   -- apodo
  add column workplace            text,   -- lugar de trabajo o parada
  add column zone                 text,   -- sector o zona (la usa la cobranza)
  add column collection_address   text,   -- dirección donde se cobra
  add column collection_reference text;   -- cómo llegar

-- 2. Garantes o fiadores -------------------------------------------------------------

create table public.customer_guarantors (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  id_doc       text,   -- cédula
  phone        text,
  address      text,
  relationship text,   -- parentesco
  created_at   timestamptz not null default now()
);
create index customer_guarantors_customer_idx on public.customer_guarantors(customer_id);

-- 3. Referencias -----------------------------------------------------------------------

create table public.customer_references (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  phone        text,
  relationship text,
  created_at   timestamptz not null default now()
);
create index customer_references_customer_idx on public.customer_references(customer_id);

create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.customer_guarantors
  for each row execute function public.bloquear_si_empresa_suspendida();
create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.customer_references
  for each row execute function public.bloquear_si_empresa_suspendida();

-- 4. RLS: se ve y se escribe lo del cliente que el usuario ve (la subconsulta
-- pasa por la política de `customers`). -----------------------------------------

alter table public.customer_guarantors enable row level security;
alter table public.customer_references enable row level security;

create policy customer_guarantors_all on public.customer_guarantors
  for all using (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_guarantors.customer_id and c.company_id = customer_guarantors.company_id))
    or public.is_super_admin())
  with check (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_guarantors.customer_id and c.company_id = customer_guarantors.company_id))
    or public.is_super_admin());

create policy customer_references_all on public.customer_references
  for all using (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_references.customer_id and c.company_id = customer_references.company_id))
    or public.is_super_admin())
  with check (
    (company_id = public.current_company_id()
     and exists (select 1 from public.customers c where c.id = customer_references.customer_id and c.company_id = customer_references.company_id))
    or public.is_super_admin());

-- 5. Grants ------------------------------------------------------------------------------

-- Este proyecto todavía da permisos por defecto a lo nuevo: se quitan primero.
revoke all on public.customer_guarantors, public.customer_references from public, anon, authenticated;
grant select, insert, update, delete on public.customer_guarantors, public.customer_references to authenticated, service_role;
