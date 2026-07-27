-- Formato 608 de DGII: registro de NCF anulados (comprobantes quemados sin
-- efecto: deterioro, error de impresión/digitación, cese, etc.).
--
-- OJO: las ventas anuladas con Nota de Crédito B04 NO van aquí — esas se
-- reportan en el 607 junto a su NC. Este registro es para NCF que nunca
-- ampararon una operación válida.

create table if not exists public.voided_ncf (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default current_company_id() references public.companies(id),
  ncf text not null,
  voided_date date not null default current_date,
  reason_code text not null,  -- catálogo DGII '01'..'09' (vive en src/lib/dgii-608.ts)
  notes text,
  user_id uuid default auth.uid(),
  user_name text,
  created_at timestamptz not null default now()
);

-- Un NCF no se anula dos veces en la misma empresa.
create unique index if not exists voided_ncf_company_ncf_key
  on public.voided_ncf (company_id, ncf);

alter table public.voided_ncf enable row level security;

drop policy if exists voided_ncf_select on public.voided_ncf;
create policy voided_ncf_select on public.voided_ncf for select
  using ((company_id = current_company_id()) or is_super_admin());

drop policy if exists voided_ncf_insert on public.voided_ncf;
create policy voided_ncf_insert on public.voided_ncf for insert
  with check (company_id = current_company_id());

-- Se permite borrar (corregir un registro mal digitado antes de remitir);
-- el archivo 608 se genera del estado vigente del período.
drop policy if exists voided_ncf_delete on public.voided_ncf;
create policy voided_ncf_delete on public.voided_ncf for delete
  using ((company_id = current_company_id()) or is_super_admin());
