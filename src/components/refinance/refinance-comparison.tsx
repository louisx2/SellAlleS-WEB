'use client';

import { ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface RefinanceComparisonProps {
  before: { installment: number; installmentsLeft: number; balance: number };
  /** null mientras los términos nuevos no son válidos. */
  after: { principal: number; interest: number; debt: number; installment: number; n: number } | null;
  /** Interés por vencer que se cancela (0 si la base es el saldo completo). */
  cancelledInterest: number;
}

// Antes y después, uno al lado del otro: es lo que el admin necesita para
// decidir y lo que después le explica al cliente. Los montos definitivos los
// calcula la base; esto es la vista previa.
export function RefinanceComparison({ before, after, cancelledInterest }: RefinanceComparisonProps) {
  const dash = '—';
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-muted-foreground">
        <span className="text-center">Ahora</span>
        <span />
        <span className="text-center font-medium text-foreground">Plan nuevo</span>
      </div>

      <Row
        label="Cuota"
        before={formatCurrency(before.installment)}
        after={after ? formatCurrency(after.installment) : dash}
        strong
      />
      <Row
        label="Cuotas que faltan"
        before={`${before.installmentsLeft}`}
        after={after ? `${after.n}` : dash}
      />
      <Row
        label="Lo que debe"
        before={formatCurrency(before.balance)}
        after={after ? formatCurrency(after.debt) : dash}
      />

      {after && (
        <p className="text-xs text-muted-foreground">
          Capital nuevo {formatCurrency(after.principal)} + interés {formatCurrency(after.interest)}.
        </p>
      )}
      {cancelledInterest > 0 && (
        <p className="text-green-600 font-medium">
          Se cancelan {formatCurrency(cancelledInterest)} de interés por vencer.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Los montos definitivos los calcula el servidor; esto es la vista previa.
      </p>
    </div>
  );
}

function Row({ label, before, after, strong }: {
  label: string; before: string; after: string; strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className={`text-center ${strong ? 'font-semibold' : ''} text-muted-foreground line-through`}>
          {before}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={`text-center ${strong ? 'font-bold text-primary text-base' : 'font-medium'}`}>
          {after}
        </span>
      </div>
    </div>
  );
}
