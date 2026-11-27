'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye } from 'lucide-react';
import { SERVICE_STATUS, statusLabel, type StatusCtx } from '@/lib/taller';
import type { ServiceEvent, ServiceStatus } from '@/lib/types';

const cuando = (d: Date) => d.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });

function texto(e: ServiceEvent, ctx: StatusCtx, nombre: (id?: string) => string, persona: (id?: string) => string): string {
  const estado = (st?: ServiceStatus) => (st ? (SERVICE_STATUS[st] ? statusLabel(st, ctx) : st) : '?');
  switch (e.kind) {
    case 'created':
      return `Creó la orden${e.toStatus ? ` (${estado(e.toStatus)})` : ''}${e.toStaff ? `, la atiende ${persona(e.toStaff)}` : e.toUser ? `, la atiende ${nombre(e.toUser)}` : ''}`;
    case 'status':
      return `Cambió a «${estado(e.toStatus)}»`;
    case 'assigned':
      if (e.fromStaff || e.toStaff) {
        if (!e.toStaff) return `Dejó la orden sin asignar (la atendía ${persona(e.fromStaff)})`;
        if (!e.fromStaff) return `Asignó la orden a ${persona(e.toStaff)}`;
        return `Pasó de ${persona(e.fromStaff)} a ${persona(e.toStaff)}`;
      }
      if (!e.toUser) return `Dejó la orden sin asignar${e.fromUser ? ` (la atendía ${nombre(e.fromUser)})` : ''}`;
      if (!e.fromUser) return `Asignó la orden a ${nombre(e.toUser)}`;
      return `Pasó de ${nombre(e.fromUser)} a ${nombre(e.toUser)}`;
    case 'charged':
      return 'Cobrado en el POS';
    case 'charge_voided':
      return 'Se anuló la venta del cobro: la orden vuelve a quedar por cobrar';
    case 'note':
    default:
      return 'Nota';
  }
}

export function Historial({ events, ctx, names, staffNames = {}, canNote, onNote }: {
  events: ServiceEvent[];
  /** Camino de la orden: decide cómo se llaman los estados. */
  ctx: StatusCtx;
  names: Record<string, string>;
  /** Nombres de las personas (service_staff), también las inactivas. */
  staffNames?: Record<string, string>;
  canNote: boolean;
  onNote: (note: string, visible: boolean) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const nombre = (id?: string) => (id ? names[id] ?? 'otro usuario' : 'nadie');
  const persona = (id?: string) => (id ? staffNames[id] ?? 'otra persona' : 'nadie');

  const submit = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const ok = await onNote(note.trim(), visible);
    setSaving(false);
    if (ok) { setNote(''); setVisible(false); }
  };

  return (
    <div className="space-y-4">
      {canNote && (
        <div className="space-y-2">
          <Textarea
            aria-label="Nueva nota"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anota lo que encontraste, lo que hablaste con el cliente…"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={visible} onCheckedChange={(v) => setVisible(v === true)} />
              Que la vea el cliente
            </label>
            <Button size="sm" onClick={submit} disabled={saving || !note.trim()}>{saving ? 'Guardando…' : 'Agregar nota'}</Button>
          </div>
        </div>
      )}
      <ol className="relative space-y-4 border-l pl-5">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
            <p className="text-sm">
              <span className="font-medium">{e.kind === 'note' ? e.note : texto(e, ctx, nombre, persona)}</span>
            </p>
            {e.kind !== 'note' && e.note && <p className="text-sm text-muted-foreground">«{e.note}»</p>}
            <p className="text-xs text-muted-foreground">
              {cuando(e.createdAt)}{e.createdByName ? ` · ${e.createdByName}` : ''}
              {e.visibleToCustomer && (
                <span className="ml-2 inline-flex items-center gap-1"><Eye className="h-3 w-3" />la ve el cliente</span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
