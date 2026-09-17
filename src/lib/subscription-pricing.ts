// Cuánto le cobra SellAlleS a una empresa al mes.
//
// Los planes con tarifa (Pro) se cobran POR SUCURSAL ACTIVA, y el precio
// depende de cómo pague la empresa: mensual o anual (el anual se guarda como
// su equivalente por mes). El plan "A medida" no tiene tarifa: lleva un monto
// mensual acordado para toda la empresa, que no se multiplica por sucursales.

export type BillingCycle = 'monthly' | 'annual';

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Mensual',
  annual: 'Anual',
};

export interface PricedPlan {
  monthly_price?: number | string | null;
  annual_price_per_month?: number | string | null;
}

export interface PricedSub {
  custom_monthly_price?: number | string | null;
  billing_cycle?: BillingCycle | null;
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

/** Tarifa por sucursal según el ciclo, o null si el plan no tiene tarifa. */
export function planRatePerBranch(plan: PricedPlan | undefined, cycle: BillingCycle | null | undefined): number | null {
  if (!plan) return null;
  const mensual = num(plan.monthly_price);
  if (cycle === 'annual') return num(plan.annual_price_per_month) ?? mensual;
  return mensual;
}

/** Ingreso mensual que deja una empresa. */
export function companyMonthlyRevenue(
  plan: PricedPlan | undefined,
  sub: PricedSub | undefined,
  activeBranches: number,
): number {
  const tarifa = planRatePerBranch(plan, sub?.billing_cycle);
  if (tarifa != null) return tarifa * Math.max(activeBranches, 1);
  return num(sub?.custom_monthly_price) ?? 0;
}
