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
};

export const isUuid = (s?: string | null): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const ITBIS_RATE = 0.18;
export const LATE_FEE_RATE = 0.05; // 5% late fee

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
  }).format(amount);
}

export function calculateFinancingStatus(sale: Sale) {
    if (!sale.financingDetails) {
        return {
            installmentsPaid: 0,
            totalInstallments: 0,
            nextDueDate: new Date(),
            pendingBalance: sale.total - sale.amountPaid,
            isOverdue: false,
            lateFee: 0,
            paymentDue: sale.total - sale.amountPaid,
            installmentAmount: 0,
        };
    }

    const { installmentAmount, installments: totalInstallments } = sale.financingDetails;
    const amountPaid = sale.amountPaid;
    const saleDate = new Date(sale.createdAt);

    const installmentsPaid = installmentAmount > 0 ? Math.floor(amountPaid / installmentAmount) : 0;
    
    const nextDueDate = addMonths(saleDate, installmentsPaid + 1);
    
    const isOverdue = isPast(nextDueDate);
    
    const lateFee = isOverdue ? installmentAmount * LATE_FEE_RATE : 0;

    const pendingBalance = sale.financingDetails.totalWithInterest - amountPaid;

    const paymentDue = installmentAmount + lateFee;

    return {
        installmentsPaid,
        totalInstallments,
        nextDueDate,
        pendingBalance: pendingBalance < 0 ? 0 : pendingBalance,
        isOverdue,
        lateFee,
        paymentDue,
        installmentAmount,
    };
}
