'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DisbursementMethod } from '@/lib/types';

interface DisbursementFieldsProps {
  method: DisbursementMethod;
  onMethodChange: (m: DisbursementMethod) => void;
  reference: string;
  onReferenceChange: (r: string) => void;
  /** La sucursal usa caja y no hay una abierta: el efectivo no se puede entregar. */
  cashDisabled: boolean;
  idPrefix: string;
}

// Cómo sale el dinero de un préstamo (o el adicional de una refinanciación). En
// efectivo, si la sucursal usa caja, la base exige caja abierta y registra la
// salida; por transferencia solo queda anotado.
export function DisbursementFields({
  method, onMethodChange, reference, onReferenceChange, cashDisabled, idPrefix,
}: DisbursementFieldsProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-disbursement`}>Entrega del dinero</Label>
      <Select value={method} onValueChange={(v) => onMethodChange(v as DisbursementMethod)}>
        <SelectTrigger id={`${idPrefix}-disbursement`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="cash" disabled={cashDisabled}>Efectivo</SelectItem>
          <SelectItem value="transfer">Transferencia</SelectItem>
        </SelectContent>
      </Select>
      {cashDisabled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">No hay caja abierta: ábrela para entregar en efectivo.</p>
      )}
      {method === 'transfer' && (
        <Input
          id={`${idPrefix}-disbursement-ref`}
          placeholder="Referencia (opcional)"
          value={reference}
          maxLength={60}
          onChange={(e) => onReferenceChange(e.target.value)}
        />
      )}
    </div>
  );
}
