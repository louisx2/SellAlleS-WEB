import type { Loan } from '@/lib/types';

// Calculado en el cliente solo para MOSTRAR (badges, próximo vencimiento); los
// montos reales de mora/capital los calcula register_loan_payment en el servidor.
// Deliberadamente separado de calculateFinancingStatus (lib/utils.ts) — el
// módulo de préstamos no depende del dominio de ventas/financiamiento.
export interface LoanStatus {
  installmentsPaid: number;
  totalInstallments: number;
  nextDueDate: Date | null;
  pendingBalance: number;
  isOverdue: boolean;
  lateFee: number;
  paymentDue: number;
  installmentAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculateLoanStatus(loan: Loan, lateFeeRate: number): LoanStatus {
  const installments = loan.installments ?? [];
  const open = installments.filter((i) => i.status !== 'paid');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdue = open.filter((i) => new Date(i.dueDate + 'T23:59:59') < today);
  const lateFee = round2(
    overdue.reduce((acc, i) => acc + Math.max(round2((i.amount * lateFeeRate) / 100) - i.lateFeePaid, 0), 0),
  );

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
  };
}
