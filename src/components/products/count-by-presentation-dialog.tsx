'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { presentationLabel } from '@/lib/presentations';
import { formatQuantity, getUnit, parseQtyInput, roundQty, unitAllowsDecimals, type UnitCode } from '@/lib/units';

export interface CountByPresentationDialogProps {
  unit: UnitCode;
  /** Solo las presentaciones completas y válidas para la unidad del producto. */
  presentations: { name: string; units: number }[];
  /** Recibe el total en unidades base; quien lo llama decide dónde escribirlo. */
  onApply: (total: number) => void;
}

// Vacío cuenta como cero: nadie escribe "0" en cada caja que no tiene.
const readCount = (raw: string) => (raw.trim() === '' ? 0 : parseQtyInput(raw));

// Este diálogo vive dentro del formulario del producto (en el árbol de React; el
// contenido sale por un portal). Por eso NO lleva su propio <form>: un submit
// aquí subiría por el árbol y guardaría el producto. Todos los botones son type="button".
export function CountByPresentationDialog({ unit, presentations, onApply }: CountByPresentationDialogProps) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<string[]>([]);
  const [loose, setLoose] = useState('');

  const u = getUnit(unit);
  const decimals = unitAllowsDecimals(unit);
  // De la más grande a la más chica, como el desglose del inventario.
  const sorted = [...presentations].sort((a, b) => b.units - a.units);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setCounts(sorted.map(() => ''));
      setLoose('');
    }
    setOpen(next);
  };

  // Total en unidades base y primer error. Un valor ilegible suma cero; la
  // pantalla muestra el error y el botón queda apagado hasta corregirlo.
  let total = 0;
  let error: string | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const n = readCount(counts[i] ?? '');
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      error ??= `En «${presentationLabel(sorted[i], u.short)}» escribe una cantidad entera, de cero en adelante.`;
      continue;
    }
    total += n * sorted[i].units;
  }
  const looseValue = readCount(loose);
  if (!Number.isFinite(looseValue) || looseValue < 0) {
    error ??= 'Las sueltas tienen que ser una cantidad válida, de cero en adelante.';
  } else if (!decimals && !Number.isInteger(looseValue)) {
    error ??= `«${u.plural}» solo admite cantidades enteras.`;
  } else {
    total += looseValue;
  }
  total = roundQty(total);

  const apply = () => {
    if (error) return;
    onApply(total);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="self-start">
          Contar por presentación
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contar por presentación</DialogTitle>
          <DialogDescription>
            Escribe cuántas hay de cada una. El total, en {u.plural}, pasa al campo de existencias.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid gap-3 py-2"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            apply();
          }}
        >
          {sorted.map((p, i) => (
            <div key={`${p.name}-${p.units}-${i}`} className="flex flex-col gap-1.5">
              <Label htmlFor={`count-${i}`}>{presentationLabel(p, u.short)}</Label>
              <Input
                id={`count-${i}`}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="0"
                value={counts[i] ?? ''}
                onChange={(e) => setCounts((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="count-loose">Sueltas ({u.short})</Label>
            <Input
              id="count-loose"
              type="number"
              inputMode={decimals ? 'decimal' : 'numeric'}
              min="0"
              step={decimals ? '0.001' : '1'}
              placeholder="0"
              value={loose}
              onChange={(e) => setLoose(e.target.value)}
            />
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            Total: <span className="font-semibold">{formatQuantity(total, unit)}</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button type="button" onClick={apply} disabled={error !== null}>
            Usar este total
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
