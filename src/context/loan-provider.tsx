'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Loan, LoanFrequency, LoanPaymentResult, PaymentMethod, RefinanceBaseMode, RefinanceLateFeeAction, VoidLoanPaymentResult } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToLoan, loanToRow, rowToLoanPaymentResult } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';
import { useSharing } from '@/context/sharing-provider';

interface NewLoanInput {
  branchId: string;
  customerId: string;
  principal: number;
  interestRate: number;
  installmentsCount: number;
  paymentFrequency: LoanFrequency;
  notes?: string;
}

interface LoanContextType {
  loans: Loan[];
  addLoan: (loan: NewLoanInput) => Promise<Loan>;
  payLoan: (loanId: string, amount: number, method: PaymentMethod, branchId?: string, notes?: string, reference?: string) => Promise<LoanPaymentResult>;
  voidLoanPayment: (paymentId: string, reason: string) => Promise<VoidLoanPaymentResult>;
  /**
   * Cierra el préstamo como refinanciado y abre uno nuevo enlazado con lo que
   * se debe (y el dinero adicional, si hay). Solo admin.
   */
  refinanceLoan: (input: RefinanceLoanInput) => Promise<RefinanceLoanResult>;
  reload: () => Promise<void>;
  loading: boolean;
}

export type RefinanceLoanInput = {
  loanId: string;
  baseMode: RefinanceBaseMode;
  /** null cuando no hay mora pendiente. */
  lateFeeAction: RefinanceLateFeeAction | null;
  /** Dinero nuevo que se le entrega al cliente (no pasa por caja). */
  additional: number;
  interestRate: number;
  installments: number;
  frequency: LoanFrequency;
  /** yyyy-mm-dd; ausente = un período después de hoy. */
  firstDueDate?: string;
  reason: string;
};

export type RefinanceLoanResult = {
  oldLoanId: string;
  newLoanId: string;
  refinancingId: string;
  newPrincipal: number;
  carriedOverAmount: number;
  totalWithInterest: number;
  installmentAmount: number;
};

const LoanContext = createContext<LoanContextType | undefined>(undefined);

// Dominio 100% independiente de sales/financing_installments/credit_payments
// (préstamos de dinero, no atados a una venta). Ver loan_installments/loan_payments
// y register_loan_payment en la base.
export function LoanProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  // Empresa activa: la impersonada si el super admin entró a un tenant, si no la
  // propia. Sin este filtro el super admin (que ignora RLS) vería préstamos de
  // TODAS las empresas — mismo criterio que branch-provider/user-provider.
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const { branchesFor, loading: sharingLoading } = useSharing();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  // Dentro de la empresa, además, solo las sucursales del pool 'prestamos'.
  // loans.branch_id es NOT NULL, así que basta el IN.
  const branchesKey = branchesFor('prestamos').join(',');

  const load = useCallback(async () => {
    if (!activeCompanyId) { setLoans([]); setLoading(false); return; }
    if (sharingLoading) return;
    const branchIds = branchesKey.split(',').filter(Boolean);
    if (branchIds.length === 0) { setLoans([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('loans')
      .select('*, customers(*), loan_installments(*)')
      .eq('company_id', activeCompanyId)
      .in('branch_id', branchIds)
      .order('created_at', { ascending: false });
    if (!error && data) setLoans(data.map(rowToLoan));
    setLoading(false);
  }, [activeCompanyId, sharingLoading, branchesKey]);

  useEffect(() => { load(); }, [load]);

  // Los montos (interés, cuotas) los calcula el trigger trg_before_loan_checks
  // en la base; el cliente solo envía los parámetros del plan.
  const addLoan = async (loanData: NewLoanInput): Promise<Loan> => {
    const userName = (typeof window !== 'undefined' && localStorage.getItem('userName')) || undefined;
    const { data, error } = await supabase
      .from('loans')
      .insert(loanToRow({ ...loanData, userName }))
      .select('*, customers(*), loan_installments(*)')
      .single();
    if (error) throw error;
    await load();
    return rowToLoan(data);
  };

  // Abono a un préstamo: RPC atómica register_loan_payment (mora primero, luego
  // capital a la cuota más antigua), independiente de register_sale_payment.
  const payLoan = async (
    loanId: string, amount: number, method: PaymentMethod, branchId?: string, notes?: string, reference?: string,
  ): Promise<LoanPaymentResult> => {
    const customerId = loans.find((l) => l.id === loanId)?.customerId;
    const { data, error } = await supabase.rpc('register_loan_payment', {
      p_loan_id: loanId, p_amount: amount, p_method: method,
      p_branch_id: branchId ?? null, p_notes: notes ?? null, p_reference: reference ?? null,
    });
    if (error) throw error;
    await load();
    const result = rowToLoanPaymentResult(data);
    // Recibo por correo, best-effort (no bloquea ni revierte el abono si falla).
    if (customerId) {
      supabase.functions.invoke('send-payment-receipt', {
        body: {
          customerId, amount, lateFeePaid: result.lateFeePaid,
          remainingBalance: result.remainingBalance, kind: 'loan',
        },
      }).catch(() => {});
    }
    return result;
  };

  // El abono no se borra: la RPC lo marca anulado y devuelve capital y mora a
  // las cuotas exactas que los recibieron (guardadas en loan_payments.allocation).
  const voidLoanPayment = async (paymentId: string, reason: string): Promise<VoidLoanPaymentResult> => {
    const { data, error } = await supabase.rpc('void_loan_payment', {
      p_payment_id: paymentId,
      p_reason: reason,
    });
    if (error) throw error;
    await load();
    return {
      paymentId: data.payment_id,
      amount: Number(data.amount),
      cashReturned: !!data.cash_returned,
      remainingBalance: Number(data.remaining_balance ?? 0),
    };
  };

  // El préstamo nuevo lo crea la base (con sus cuotas y la mora vigente); aquí
  // solo se recarga para que aparezca en la lista.
  const refinanceLoan = async (input: RefinanceLoanInput): Promise<RefinanceLoanResult> => {
    const { data, error } = await supabase.rpc('refinance_loan', {
      p_loan_id: input.loanId,
      p_base_mode: input.baseMode,
      p_late_fee_action: input.lateFeeAction,
      p_additional: input.additional,
      p_interest_rate: input.interestRate,
      p_installments: input.installments,
      p_frequency: input.frequency,
      p_first_due: input.firstDueDate || null,
      p_reason: input.reason,
    });
    if (error) throw error;
    await load();
    return {
      oldLoanId: data.old_loan_id,
      newLoanId: data.new_loan_id,
      refinancingId: data.refinancing_id,
      newPrincipal: Number(data.new_principal),
      carriedOverAmount: Number(data.carried_over_amount),
      totalWithInterest: Number(data.total_with_interest),
      installmentAmount: Number(data.installment_amount),
    };
  };

  return (
    <LoanContext.Provider value={{ loans, addLoan, payLoan, voidLoanPayment, refinanceLoan, reload: load, loading }}>
      {children}
    </LoanContext.Provider>
  );
}

export const useLoans = (): LoanContextType => {
  const context = useContext(LoanContext);
  if (context === undefined) throw new Error('useLoans must be used within a LoanProvider');
  return context;
};
