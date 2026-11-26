'use client';

import { useMemo } from 'react';
import { useSales } from '@/context/sales-provider';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { calculateFinancingStatus } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import type { Saldo } from '@/lib/motos';

/** Lo que se debe de cada venta (financiada o a crédito) y de cada préstamo, para
 *  la cuenta de una moto. La mora usa la política de la empresa, como los demás
 *  reportes. */
export function useSaldosDeVehiculos(): { ventas: Map<string, Saldo>; prestamos: Map<string, Saldo> } {
  const { sales, financingSales } = useSales();
  const { loans } = useLoans();
  const { profile } = useCompanyProfile();

  const ventas = useMemo(() => {
    const m = new Map<string, Saldo>();
    for (const s of sales) {
      if (s.cancelledAt || s.paymentMethod !== 'credit') continue;
      m.set(s.id, { pendiente: Math.max(0, Math.round((s.total - s.amountPaid) * 100) / 100), atrasado: false });
    }
    for (const s of financingSales) {
      if (s.cancelledAt) continue;
      const st = calculateFinancingStatus(s, profile.lateFeeRate, profile.lateFeeGraceDays);
      m.set(s.id, { pendiente: st.pendingBalance, atrasado: st.isOverdue });
    }
    return m;
  }, [sales, financingSales, profile.lateFeeRate, profile.lateFeeGraceDays]);

  const prestamos = useMemo(() => {
    const m = new Map<string, Saldo>();
    for (const l of loans) {
      if (l.status === 'paid' || l.status === 'refinanced' || l.status === 'cancelled') {
        m.set(l.id, { pendiente: 0, atrasado: false });
        continue;
      }
      const st = calculateLoanStatus(l, profile.loanLateFeeRate, profile.loanLateFeeGraceDays);
      m.set(l.id, { pendiente: st.pendingBalance, atrasado: st.isOverdue });
    }
    return m;
  }, [loans, profile.loanLateFeeRate, profile.loanLateFeeGraceDays]);

  return { ventas, prestamos };
}
