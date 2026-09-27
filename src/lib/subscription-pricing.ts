// Cuánto le cobra SellAlleS a una empresa al mes.
//
// Los planes con tarifa (Pro) se cobran POR SUCURSAL ACTIVA, y el precio
// depende de cómo pague la empresa: mensual o anual (el anual se guarda como
// su equivalente por mes). El plan "A medida" no tiene tarifa: lleva un monto
// mensual acordado para toda la empresa, que no se multiplica por sucursales.
// Una sucursal puede tener su propio precio (branches.cuota_mensual), que
// reemplaza la tarifa del plan solo para ella.

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

/** Ingreso mensual que deja una empresa. `activeBranches` es cuántas
 *  sucursales activas tiene, o el precio propio de cada una (null = la tarifa
 *  del plan), igual que calcula la base en _cuenta_de_suscripcion. */
export function companyMonthlyRevenue(
  plan: PricedPlan | undefined,
  sub: PricedSub | undefined,
  activeBranches: number | (number | null)[],
): number {
  const tarifa = planRatePerBranch(plan, sub?.billing_cycle);
  if (tarifa != null) {
    if (typeof activeBranches === 'number') return tarifa * Math.max(activeBranches, 1);
    if (activeBranches.length === 0) return tarifa;
    return activeBranches.reduce<number>((acc, precio) => acc + (precio ?? tarifa), 0);
  }
  return num(sub?.custom_monthly_price) ?? 0;
}
