'use client';

import { formatCurrency } from '@/lib/utils';
import type { RefinanceQuote } from '@/lib/types';

// Lo que el cliente debe hoy, partido como lo ve la base. El interés por
// vencer es el que el plan cobra por adelantado (add-on) y todavía no se ha
// ganado: es lo que se cancela si se refinancia solo el capital.
export function RefinanceQuoteSummary({ quote }: { quote: RefinanceQuote }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
      <Item label="Saldo pendiente" value={formatCurrency(quote.pendingBalance)} strong />
      <Item label="Capital pendiente" value={formatCurrency(quote.pendingCapital)} />
      <Item label="Interés por vencer" value={formatCurrency(quote.unearnedInterest)} />
      <Item
        label="Mora pendiente"
        value={formatCurrency(quote.lateFeeDue)}
        className={quote.lateFeeDue > 0 ? 'text-destructive' : undefined}
      />
    </div>
  );
}

function Item({ label, value, strong, className }: {
  label: string; value: string; strong?: boolean; className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={[strong ? 'font-semibold' : 'font-medium', className].filter(Boolean).join(' ')}>{value}</p>
    </div>
  );
}
