'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ANSWER_LABEL } from '@/lib/taller';
import type { ChecklistAnswer, ChecklistAnswerValue, ChecklistItem } from '@/lib/types';

const VALUES: ChecklistAnswerValue[] = ['si', 'no', 'np'];

/** Chequeos de llegada: cada uno se contesta Sí / No / No se pudo probar, con nota. */
export function ChecklistForm({ items, answers, onChange, requiredOf }: {
  items: ChecklistItem[];
  answers: Record<string, ChecklistAnswer | undefined>;
  onChange: (answers: Record<string, ChecklistAnswer | undefined>) => void;
  /** Qué marca de "obligatorio" mostrar (la del ingreso completo o la de rápida). */
  requiredOf: (item: ChecklistItem) => boolean;
}) {
  const set = (item: ChecklistItem, patch: Partial<ChecklistAnswer>) => {
    const prev = answers[item.id];
    const next: ChecklistAnswer = {
      itemId: item.id,
      label: item.label,
      answer: prev?.answer ?? 'si',
      note: prev?.note,
      ...patch,
    };
    onChange({ ...answers, [item.id]: next });
  };

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const a = answers[item.id];
        return (
          <div key={item.id} className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] sm:items-center">
            <span className="text-sm font-medium">
              {item.label}
              {requiredOf(item) && <span className="text-destructive" title="Obligatorio"> *</span>}
            </span>
            <div className="flex gap-1" role="group" aria-label={item.label}>
              {VALUES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={a?.answer === v}
                  onClick={() => set(item, { answer: v })}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    a?.answer === v
                      ? v === 'no'
                        ? 'border-destructive bg-destructive text-destructive-foreground'
                        : 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  {v === 'np' ? 'No probado' : ANSWER_LABEL[v]}
                </button>
              ))}
            </div>
            {/* Sin respuesta no hay nota: si no, escribirla contestaría "Sí" sin querer. */}
            <Input
              aria-label={`Nota de ${item.label}`}
              value={a?.note ?? ''}
              disabled={!a}
              onChange={(e) => set(item, { note: e.target.value })}
              placeholder={a ? 'Nota (opcional)' : 'Contesta primero'}
              className="h-8"
            />
          </div>
        );
      })}
    </div>
  );
}
