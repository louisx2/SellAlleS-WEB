import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Sale } from "./types";
import { addMonths, isPast } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
