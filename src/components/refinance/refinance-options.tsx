'use client';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatCurrency } from '@/lib/utils';
import type { RefinanceBaseMode, RefinanceLateFeeAction, RefinanceQuote } from '@/lib/types';

interface RefinanceOptionsProps {
  quote: RefinanceQuote;
  base: RefinanceBaseMode;
  onBaseChange: (base: RefinanceBaseMode) => void;
  lateFee: RefinanceLateFeeAction | null;
  onLateFeeChange: (action: RefinanceLateFeeAction) => void;
}

// Las dos decisiones de dinero de una refinanciación: sobre qué monto se arma
// el plan nuevo y qué pasa con la mora. La mora no trae nada marcado a
// propósito: perdonarla o cobrarla es una decisión que el admin tiene que
// tomar, no un valor por defecto que se acepta sin leer.
export function RefinanceOptions({ quote, base, onBaseChange, lateFee, onLateFeeChange }: RefinanceOptionsProps) {
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <p className="font-medium">¿Sobre qué monto se arma el plan nuevo?</p>
        <RadioGroup value={base} onValueChange={(v) => onBaseChange(v as RefinanceBaseMode)} className="gap-2">
          <div className="flex items-start gap-2">
            <RadioGroupItem value="capital" id="refi-base-capital" className="mt-0.5" />
            <Label htmlFor="refi-base-capital" className="font-normal leading-snug">
              Solo el capital — {formatCurrency(quote.pendingCapital)}
              <span className="block text-xs text-muted-foreground">
                Se cancelan {formatCurrency(quote.unearnedInterest)} de interés que todavía no se ha ganado.
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="balance" id="refi-base-balance" className="mt-0.5" />
            <Label htmlFor="refi-base-balance" className="font-normal leading-snug">
              Saldo completo — {formatCurrency(quote.pendingBalance)}
              <span className="block text-xs text-muted-foreground">
                El plan nuevo cobra interés también sobre el interés que faltaba.
              </span>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {quote.lateFeeDue > 0 && (
        <div className="space-y-2">
          <p className="font-medium">Mora pendiente: {formatCurrency(quote.lateFeeDue)}</p>
          <RadioGroup
            value={lateFee ?? ''}
            onValueChange={(v) => onLateFeeChange(v as RefinanceLateFeeAction)}
            className="gap-2"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="capitalize" id="refi-late-capitalize" className="mt-0.5" />
              <Label htmlFor="refi-late-capitalize" className="font-normal leading-snug">
                Sumarla al capital nuevo
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="forgive" id="refi-late-forgive" className="mt-0.5" />
              <Label htmlFor="refi-late-forgive" className="font-normal leading-snug">
                Perdonarla
                <span className="block text-xs text-muted-foreground">
                  Queda registrada en la bitácora con el motivo y quién la perdonó.
                </span>
              </Label>
            </div>
          </RadioGroup>
          {!lateFee && <p className="text-xs text-destructive">Elige qué hacer con la mora.</p>}
        </div>
      )}
    </div>
  );
}
