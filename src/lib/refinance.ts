import type { RefinanceBaseMode, RefinanceLateFeeAction, RefinanceQuote } from '@/lib/types';
import { monthsFor, type InterestMode, type PaymentFrequency } from '@/lib/frequency';
import { supabase } from '@/lib/supabase/client';
import { rowToRefinanceQuote } from '@/lib/supabase/mappers';

// Refinanciar: lo que se debe hoy pasa a un plan nuevo. Las cifras que se
// graban las calcula la base (`refinance_financing` / `refinance_loan`); esto
// solo arma la vista previa con las mismas fórmulas, para que el admin vea la
// cuota antes de confirmar.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lo que se debe hoy, partido como lo cobra la base: capital pendiente,
 * interés que aún no se ganó y mora. Solo admin (la RPC lo exige).
 */
export async function fetchRefinanceQuote(kind: 'loan' | 'financing', id: string): Promise<RefinanceQuote> {
  const { data, error } = await supabase.rpc('refinance_quote', { p_kind: kind, p_id: id });
  if (error) throw error;
  return rowToRefinanceQuote(data);
}

/**
 * Capital del plan nuevo. `carried` es lo que viene de la deuda vieja (la base
 * elegida más la mora si se suma); `principal` le agrega el dinero nuevo que se
 * entrega, que solo existe en préstamos.
 */
export function refinanceBase(
  q: RefinanceQuote,
  base: RefinanceBaseMode,
  lateFee: RefinanceLateFeeAction | null,
  additional = 0,
): { carried: number; principal: number } {
  const fromDebt = base === 'capital' ? q.pendingCapital : q.pendingBalance;
  const lateFeeIn = lateFee === 'capitalize' && q.lateFeeDue > 0 ? q.lateFeeDue : 0;
  const carried = round2(fromDebt + lateFeeIn);
  return { carried, principal: round2(carried + Math.max(additional, 0)) };
}

/**
 * Mismo cálculo que `financing_plan` en la base (y que el trigger de
 * préstamos, que es el caso `monthly_prorated`): interés simple sobre los
 * meses que dura el plan, cuota = deuda / cuotas. La última cuota absorbe el
 * redondeo en la base; aquí se muestra la cuota normal.
 */
export function previewRefinancePlan(
  principal: number,
  rate: number,
  n: number,
  freq: PaymentFrequency,
  mode: InterestMode,
): { interest: number; debt: number; installment: number } {
  const p = round2(principal);
  const interest = round2(p * (rate / 100) * monthsFor(freq, n, mode));
  const debt = round2(p + interest);
  return { interest, debt, installment: n > 0 ? round2(debt / n) : 0 };
}
