-- Cómo paga cada empresa su suscripción: mensual o anual.
-- El panel de super admin lo usa para elegir la tarifa por sucursal
-- (plans.monthly_price o plans.annual_price_per_month) al calcular el MRR.
alter table public.subscriptions
  add column if not exists billing_cycle text not null default 'monthly';

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_cycle_check;

alter table public.subscriptions
  add constraint subscriptions_billing_cycle_check
  check (billing_cycle in ('monthly', 'annual'));
