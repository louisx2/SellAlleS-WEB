'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Loan, LoanFrequency, LoanPaymentResult, PaymentMethod } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToLoan, loanToRow, rowToLoanPaymentResult } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

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
  reload: () => Promise<void>;
  loading: boolean;
}

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
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setLoans([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('loans')
      .select('*, customers(*), loan_installments(*)')
      .eq('company_id', activeCompanyId)
      .order('created_at', { ascending: false });
    if (!error && data) setLoans(data.map(rowToLoan));
    setLoading(false);
  }, [activeCompanyId]);

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

  return (
    <LoanContext.Provider value={{ loans, addLoan, payLoan, reload: load, loading }}>
      {children}
    </LoanContext.Provider>
  );
}

export const useLoans = (): LoanContextType => {
  const context = useContext(LoanContext);
  if (context === undefined) throw new Error('useLoans must be used within a LoanProvider');
  return context;
};
