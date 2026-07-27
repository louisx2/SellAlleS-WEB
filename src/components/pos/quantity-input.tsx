'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatQty, parseQtyInput, qtyInputRegex, unitAllowsDecimals } from '@/lib/units';

interface QuantityInputProps {
  value: number;
  /** Código de unidad del producto: decide si se puede teclear el punto. */
  unit?: string | null;
  onCommit: (qty: number) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/** Campo de cantidad que respeta la unidad del producto: en unidades contables
 *  el punto no se puede ni teclear; en medibles admite hasta 3 decimales.
 *  Confirma al salir del campo o con Enter; Escape descarta. */
export function QuantityInput({
  value, unit, onCommit, className, id, 'aria-label': ariaLabel = 'Cantidad',
}: QuantityInputProps) {
  const [draft, setDraft] = useState(() => formatQty(value));
  // Se incrementa en cada confirmación para reescribir el borrador aunque
  // `value` no cambie: si el store rechaza la cantidad por falta de stock, el
  // campo debe volver solo a lo que sí quedó aceptado.
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    setDraft(formatQty(value));
  }, [value, unit, syncTick]);

  const handleChange = (raw: string) => {
    if (qtyInputRegex(unit).test(raw)) setDraft(raw);
  };

  const commit = () => {
    const parsed = parseQtyInput(draft);
    // Un campo vacío o con basura no borra la línea: simplemente se revierte.
    if (Number.isFinite(parsed)) onCommit(parsed);
    setSyncTick((t) => t + 1);
  };

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      // type="text" y no "number": evita que la rueda del mouse cambie la
      // cantidad sin querer y esquiva la validación de `step` del navegador.
      type="text"
      inputMode={unitAllowsDecimals(unit) ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(formatQty(value)); e.currentTarget.blur(); }
      }}
      className={cn('text-center', className)}
    />
  );
}
