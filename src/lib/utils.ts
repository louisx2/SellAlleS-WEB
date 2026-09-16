import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Customer, Sale } from "./types";
import { isPast } from 'date-fns';
import { addPeriods } from './frequency';
import {
  lateFeeDue,
  overdueDays,
  resolveLateFeePolicy,
  totalLateFeeDue,
  type LateFeePolicy,
} from './late-fee';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Cliente por defecto del POS ("Consumidor Final"). Vive solo en el cliente:
// las ventas con este cliente se guardan con customer_id NULL en la base.
export const GENERIC_CUSTOMER: Customer = {
  id: '0',
  name: 'Consumidor Final',
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
  // La que va a cobrar la RPC: sale del plan congelado, no de los ajustes de
  // hoy. La UI la usa para explicar de dónde viene el número.
  lateFeePolicy: LateFeePolicy;
};

// Estado del plan derivado de las cuotas reales (financing_installments),
// que genera y actualiza la base.
//
// Los `fallback*` (los ajustes vigentes de la empresa) solo se usan para los
// planes creados antes de que la mora se congelara en la venta. Cuando el plan
// trae la suya manda esa: es la que va a cobrar la RPC de abonos, y mostrar otra
// en pantalla haría que el cajero anunciara un número y el sistema cobrara otro.
export function calculateFinancingStatus(
    sale: Sale,
    fallbackLateFeeRate: number = DEFAULT_LATE_FEE_RATE,
    fallbackGraceDays: number = 0,
): FinancingStatus {
    const installments = sale.installments ?? [];
    const frequency = sale.financingDetails?.frequency ?? 'monthly';
    const policy = resolveLateFeePolicy(
        sale.financingDetails,
        { rate: fallbackLateFeeRate, graceDays: fallbackGraceDays },
        frequency,
    );

    if (installments.length > 0) {
        const open = installments.filter(i => i.status !== 'paid');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Atrasada es una cuestión de fecha, no de monto: con la mora en 0% no
        // se cobra nada, pero el cliente sigue debiendo tarde y los reportes
        // tienen que decirlo. La gracia se descuenta igual que en la base.
        const overdue = open.filter(i => overdueDays(i.dueDate, today, policy.graceDays) > 0);
        const lateFee = totalLateFeeDue(open, policy, today);

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
            lateFeePolicy: policy,
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
            lateFeePolicy: policy,
        };
    }

    const { installmentAmount, installments: totalInstallments } = sale.financingDetails;
    const installmentsPaid = installmentAmount > 0 ? Math.floor(sale.amountPaid / installmentAmount) : 0;
    const nextDueDate = addPeriods(new Date(sale.createdAt), frequency, installmentsPaid + 1);
    const isOverdue = isPast(nextDueDate) && pendingBalance > 0;
    // Sin tabla de cuotas se estima sobre la próxima que tocaba. Es solo para
    // pintar: sin cuotas en la base, la RPC de abonos no cobra mora ninguna.
    const lateFee = isOverdue
        ? lateFeeDue(
            {
                amount: installmentAmount,
                paidAmount: 0,
                lateFeePaid: 0,
                dueDate: nextDueDate.toISOString().slice(0, 10),
            },
            policy,
            new Date(),
          )
        : 0;

    return {
        installmentsPaid,
        totalInstallments,
        nextDueDate,
        pendingBalance,
        isOverdue,
        lateFee,
        paymentDue: round2(installmentAmount + lateFee),
        installmentAmount,
        lateFeePolicy: policy,
    };
}
