'use client';

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ANSWER_LABEL, notaVisible } from '@/lib/taller';
import type { ChecklistAnswer, ChecklistAnswerValue, ChecklistItem } from '@/lib/types';

const VALUES: ChecklistAnswerValue[] = ['si', 'no', 'np'];

/** Chequeos de llegada, dos por fila: cada uno se contesta Sí / No / No se pudo
 *  probar. La nota sale sola con «No» o si ya tiene algo; si no, con el ícono. */
export function ChecklistForm({ items, answers, onChange, requiredOf }: {
  items: ChecklistItem[];
  answers: Record<string, ChecklistAnswer | undefined>;
  onChange: (answers: Record<string, ChecklistAnswer | undefined>) => void;
  /** Qué marca de "obligatorio" mostrar (la del ingreso completo o la de rápida). */
  requiredOf: (item: ChecklistItem) => boolean;
}) {
  // Chequeos con la nota abierta a mano (con el ícono).
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [enfocar, setEnfocar] = useState<string | null>(null);

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

  const alternarNota = (id: string) => {
    const abrir = !abiertas.has(id);
    const s = new Set(abiertas);
    if (abrir) s.add(id); else s.delete(id);
    setAbiertas(s);
    setEnfocar(abrir ? id : null);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const a = answers[item.id];
        const conNota = notaVisible(a, abiertas.has(item.id));
        // Con «No» o con algo escrito la nota se ve sola: el ícono no hace falta.
        const forzada = notaVisible(a, false);
        return (
          <div key={item.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-[7rem] flex-1 text-sm font-medium">
                {item.label}
                {requiredOf(item) && <span className="text-destructive" title="Obligatorio"> *</span>}
              </span>
              <div className="flex items-center gap-1">
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
                {a && !forzada && (
                  <button
                    type="button"
                    aria-label={conNota ? `Ocultar la nota de ${item.label}` : `Escribir una nota de ${item.label}`}
                    aria-expanded={conNota}
                    title={conNota ? 'Ocultar nota' : 'Escribir nota'}
                    onClick={() => alternarNota(item.id)}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted',
                      conNota ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <StickyNote className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            {conNota && (
              <Input
                aria-label={`Nota de ${item.label}`}
                value={a?.note ?? ''}
                onChange={(e) => set(item, { note: e.target.value })}
                placeholder="Nota (opcional)"
                autoFocus={enfocar === item.id}
                className="mt-2 h-8"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
