-- Motopréstamos 4A: registro de recuperaciones, columnas y estados.
-- Diseño: docs/superpowers/specs/2026-11-23-motoprestamos-design.md (Entrega 4)
-- Plan:   docs/superpowers/plans/2026-11-24-motoprestamos-entrega-4a-recuperacion.md (Task 1)
--
-- Solo crea la tabla, agrega columnas que admiten null y amplía dos checks; no
-- cambia ninguna función viva. Las RPC llegan en la migración siguiente.
-- Pruebas: supabase/tests/motos_recuperacion.sql

-- 1. Registro de recuperaciones -----------------------------------------------------------
-- Una fila por recuperación: venta (la moto vuelve al inventario y el saldo se da de
-- baja) o garantía (incautada → devuelta o liquidada). Se escribe solo por las RPC.

create table public.vehicle_recoveries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  branch_id        uuid not null references public.branches(id) on delete cascade,
  vehicle_id       uuid not null references public.vehicles(id) on delete cascade,
  kind             text not null check (kind in ('venta', 'garantia')),
  sale_id          uuid references public.sales(id) on delete set null,
  loan_id          uuid references public.loans(id) on delete set null,
  status           text not null check (status in ('incautada', 'devuelta', 'liquidada', 'recuperada')),
  recovered_on     date not null,
  reason           text,
  condition_note   text,
  debt_at_recovery numeric(14,2),
  reentry_value    numeric(14,2) check (reentry_value is null or reentry_value >= 0),
  written_off      numeric(14,2) not null default 0,
  refunded         numeric(14,2) not null default 0,
  refund_method    text check (refund_method is null or refund_method in ('cash', 'transfer')),
  liquidation_mode text check (liquidation_mode is null or liquidation_mode in ('tercero', 'dacion')),
  proceeds         numeric(14,2),
  applied          numeric(14,2),
  shortfall_action text check (shortfall_action is null or shortfall_action in ('deuda', 'baja')),
  payment_id       uuid,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null default auth.uid(),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index vehicle_recoveries_vehicle_idx on public.vehicle_recoveries(vehicle_id, created_at);
create index vehicle_recoveries_branch_idx on public.vehicle_recoveries(branch_id, recovered_on);

create trigger trg_bloquear_empresa_suspendida before insert or update or delete on public.vehicle_recoveries
  for each row execute function public.bloquear_si_empresa_suspendida();

alter table public.vehicle_recoveries enable row level security;
create policy vehicle_recoveries_select on public.vehicle_recoveries
  for select using (
    (company_id = public.current_company_id() and public.motos_tiene_permiso(branch_id, 'motos', 'view'))
    or public.is_super_admin());

-- 2. Venta recuperada y préstamo con saldo dado de baja ---------------------------------------
-- La venta recuperada queda en `paid` (sale de todo lo abierto) con la fecha y lo que
-- se dio de baja; la pantalla la muestra como «Recuperada».

alter table public.sales
  add column recovered_at       timestamptz,
  add column written_off_amount numeric(14,2);
alter table public.loans
  add column written_off_amount numeric(14,2);

-- Una venta recuperada no se anula: la moto ya volvió al inventario y el saldo se dio de baja.
create or replace function public.motos_venta_recuperada_no_se_anula()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.recovered_at is not null and old.cancelled_at is null and new.cancelled_at is not null then
    raise exception 'Esta venta se recuperó: no se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_venta_recuperada_no_se_anula before update of cancelled_at on public.sales
  for each row execute function public.motos_venta_recuperada_no_se_anula();

-- 3. Eventos de la ficha y método «dación en pago» ------------------------------------------
-- Los valores vivos más los nuevos. `dacion` solo lo acepta register_loan_payment cuando
-- lo llama la liquidación de una garantía (migración siguiente).

alter table public.vehicle_events drop constraint vehicle_events_kind_check;
alter table public.vehicle_events add constraint vehicle_events_kind_check check (kind = any (array[
  'ingreso', 'venta', 'venta_anulada', 'cambio_estado', 'matricula', 'edicion', 'baja', 'garantia', 'liberacion',
  'incautacion', 'devolucion', 'liquidacion', 'recuperacion']));

alter table public.loan_payments drop constraint loan_payments_method_check;
alter table public.loan_payments add constraint loan_payments_method_check
  check (method = any (array['cash', 'card', 'transfer', 'dacion']));

-- 4. Grants --------------------------------------------------------------------------------------

revoke all on public.vehicle_recoveries from public, anon, authenticated;
grant select on public.vehicle_recoveries to authenticated;
grant select, insert, update, delete on public.vehicle_recoveries to service_role;

revoke execute on function public.motos_venta_recuperada_no_se_anula() from public, anon, authenticated;
grant execute on function public.motos_venta_recuperada_no_se_anula() to service_role;
