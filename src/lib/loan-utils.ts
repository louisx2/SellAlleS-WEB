import type { Loan } from '@/lib/types';
import {
  overdueDays,
  resolveLateFeePolicy,
  totalLateFeeDue,
  type LateFeePolicy,
} from '@/lib/late-fee';

// Calculado en el cliente solo para MOSTRAR (badges, próximo vencimiento); los
// montos reales de mora/capital los calcula register_loan_payment en el servidor.
// Deliberadamente separado de calculateFinancingStatus (lib/utils.ts) — el
// módulo de préstamos no depende del dominio de ventas/financiamiento. Lo que sí
// comparten es la fórmula de la mora (lib/late-fee.ts): esa tiene que ser una
// sola, y la misma que corre en la base.
export interface LoanStatus {
  installmentsPaid: number;
  totalInstallments: number;
  nextDueDate: Date | null;
  pendingBalance: number;
  isOverdue: boolean;
  lateFee: number;
  paymentDue: number;
  installmentAmount: number;
  lateFeePolicy: LateFeePolicy;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `fallbackLateFeeRate` y `fallbackGraceDays` (los ajustes vigentes de la
 * empresa) solo aplican a los préstamos anteriores a la mora configurable, que
 * no traen política congelada. Cuando el préstamo trae la suya manda esa: es la
 * que va a cobrar la RPC, y mostrar otra en pantalla haría que el cajero
 * anunciara un número y el sistema cobrara otro.
 */
export function calculateLoanStatus(
  loan: Loan,
  fallbackLateFeeRate: number,
  fallbackGraceDays: number = 0,
): LoanStatus {
  const installments = loan.installments ?? [];
  const open = installments.filter((i) => i.status !== 'paid');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const policy = resolveLateFeePolicy(
    {
      lateFeeRate: loan.lateFeeRate,
      lateFeeMode: loan.lateFeeMode,
      lateFeeGraceDays: loan.lateFeeGraceDays,
      lateFeeMaxRate: loan.lateFeeMaxRate,
    },
    { rate: fallbackLateFeeRate, graceDays: fallbackGraceDays },
    loan.paymentFrequency,
  );

  // Atrasada es una cuestión de fecha, no de monto: con la mora en 0% no se
  // cobra nada, pero el cliente sigue debiendo tarde. Los días de gracia sí se
  // descuentan — antes se ignoraban acá y la pantalla marcaba un atraso que la
  // RPC no cobraba.
  const overdue = open.filter((i) => overdueDays(i.dueDate, today, policy.graceDays) > 0);
  const lateFee = totalLateFeeDue(open, policy, today);

  const next = open[0] ?? null;
  const pendingBalance = round2(loan.totalWithInterest - loan.amountPaid);

  return {
    installmentsPaid: installments.length - open.length,
    totalInstallments: installments.length,
    nextDueDate: next ? new Date(next.dueDate + 'T00:00:00') : null,
    pendingBalance: Math.max(pendingBalance, 0),
    isOverdue: overdue.length > 0,
    lateFee,
    paymentDue: round2((next ? next.amount - next.paidAmount : 0) + lateFee),
    installmentAmount: next?.amount ?? 0,
    lateFeePolicy: policy,
  };
}
