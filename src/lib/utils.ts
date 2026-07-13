import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Customer, Sale } from "./types";
import { addMonths, isPast } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Cliente por defecto del POS ("Consumidor Final"). Vive solo en el cliente:
// las ventas con este cliente se guardan con customer_id NULL en la base.
export const GENERIC_CUSTOMER: Customer = {
  id: '0',
  name: 'Cliente Genérico',
  phone: '',
  rnc: '',
  ncfType: 'consumer',
  creditBalance: 0,
  discountPercentage: 0,
  loyaltyPurchaseCount: 0,
};

export const isUuid = (s?: string | null): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const ITBIS_RATE = 0.18;
export const DEFAULT_LATE_FEE_RATE = 5; // % de mora; el valor real vive en companies.late_fee_rate

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
  }).format(amount);
}

export type FinancingStatus = {
  installmentsPaid: number;
  totalInstallments: number;
  nextDueDate: Date | null;
  pendingBalance: number;
  isOverdue: boolean;
  lateFee: number;           // mora exigible ahora mismo
  paymentDue: number;        // sugerido: lo pendiente de la próxima cuota + mora
  installmentAmount: number;
};

// Estado del plan derivado de las cuotas reales (financing_installments),
// que genera y actualiza la base. lateFeeRate es % (companies.late_fee_rate).
export function calculateFinancingStatus(sale: Sale, lateFeeRate: number = DEFAULT_LATE_FEE_RATE): FinancingStatus {
    const installments = sale.installments ?? [];

    if (installments.length > 0) {
        const open = installments.filter(i => i.status !== 'paid');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const overdue = open.filter(i => new Date(i.dueDate + 'T23:59:59') < today);
        const lateFee = round2(overdue.reduce(
            (acc, i) => acc + Math.max(round2(i.amount * lateFeeRate / 100) - i.lateFeePaid, 0), 0));

        const next = open[0] ?? null;
        const pendingBalance = round2(open.reduce((acc, i) => acc + (i.amount - i.paidAmount), 0));

        return {
            installmentsPaid: installments.length - open.length,
            totalInstallments: installments.length,
            nextDueDate: next ? new Date(next.dueDate + 'T00:00:00') : null,
            pendingBalance,
            isOverdue: overdue.length > 0,
            lateFee,
            paymentDue: round2((next ? next.amount - next.paidAmount : 0) + lateFee),
            installmentAmount: sale.financingDetails?.installmentAmount ?? (next?.amount ?? 0),
        };
    }

    // Ventas a crédito simple (sin plan de cuotas) y ventas financiadas
    // anteriores a la tabla de cuotas: solo hay saldo pendiente.
    const totalOwed = sale.financingDetails?.totalWithInterest ?? sale.total;
    const pendingBalance = Math.max(round2(totalOwed - sale.amountPaid), 0);
    if (!sale.financingDetails) {
        return {
            installmentsPaid: 0,
            totalInstallments: 0,
            nextDueDate: null,
            pendingBalance,
            isOverdue: false,
            lateFee: 0,
            paymentDue: pendingBalance,
            installmentAmount: 0,
        };
    }

    const { installmentAmount, installments: totalInstallments } = sale.financingDetails;
    const installmentsPaid = installmentAmount > 0 ? Math.floor(sale.amountPaid / installmentAmount) : 0;
    const nextDueDate = addMonths(new Date(sale.createdAt), installmentsPaid + 1);
    const isOverdue = isPast(nextDueDate) && pendingBalance > 0;
    const lateFee = isOverdue ? round2(installmentAmount * lateFeeRate / 100) : 0;

    return {
        installmentsPaid,
        totalInstallments,
        nextDueDate,
        pendingBalance,
        isOverdue,
        lateFee,
        paymentDue: round2(installmentAmount + lateFee),
        installmentAmount,
    };
}
