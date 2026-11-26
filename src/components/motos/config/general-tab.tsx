'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AVISO_BASE, MARCADORES_AVISO, MARCADORES_RECIBO, RECIBO_BASE, marcadoresDesconocidosEn,
} from '@/lib/cobranza-mensajes';
import { useToast } from '@/hooks/use-toast';
import { useMotosAjustes } from '@/hooks/use-motos-ajustes';
import type { MotosSettings } from '@/lib/types';

type Interruptor = { campo: keyof Pick<MotosSettings, 'custodyFinancedSale' | 'custodyCashSale' | 'custodyLoan' | 'requireGuarantor'>; titulo: string; ayuda: string };

const CUSTODIA: Interruptor[] = [
  { campo: 'custodyFinancedSale', titulo: 'Venta a crédito o financiada', ayuda: 'El negocio guarda la matrícula hasta que se salde la venta.' },
  { campo: 'custodyCashSale', titulo: 'Venta de contado', ayuda: 'Encendido: la matrícula queda «lista para entregar» (el negocio la tramita y la entrega después). Apagado: se entrega con la moto.' },
  { campo: 'custodyLoan', titulo: 'Préstamo con la moto en garantía', ayuda: 'Cómo arranca la opción «La matrícula queda en custodia» al prestar.' },
];

type Plantilla = {
  campo: 'whatsappReminder' | 'whatsappReceipt';
  titulo: string;
  ayuda: string;
  base: string;
  marcadores: { clave: string; descripcion: string }[];
};

const PLANTILLAS: Plantilla[] = [
  { campo: 'whatsappReminder', titulo: 'Aviso de cuota', ayuda: 'Lo que se manda desde «Avisos de cobro» a quien tiene cuota mañana, hoy o atrasada.', base: AVISO_BASE, marcadores: MARCADORES_AVISO },
  { campo: 'whatsappReceipt', titulo: 'Recibo de abono', ayuda: 'Lo que acompaña al enlace del recibo cuando el cobrador lo manda al cobrar.', base: RECIBO_BASE, marcadores: MARCADORES_RECIBO },
];

/** Una plantilla de WhatsApp: el texto, sus marcadores y el aviso si hay alguno mal escrito. */
function PlantillaMensaje({ p, valor, canEdit, onGuardar }: {
  p: Plantilla; valor?: string; canEdit: boolean; onGuardar: (texto: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState(valor ?? p.base);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTexto(valor ?? p.base); }, [valor, p.base]);
  const desconocidos = marcadoresDesconocidosEn(texto, p.marcadores.map((m) => m.clave));
  const cambiado = texto.trim() !== (valor ?? p.base).trim();

  const guardar = async () => {
    setSaving(true);
    try { await onGuardar(texto); } finally { setSaving(false); }
  };

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <Label htmlFor={`motos-${p.campo}`} className="font-medium">{p.titulo}</Label>
      <p className="text-xs text-muted-foreground">{p.ayuda}</p>
      <Textarea id={`motos-${p.campo}`} rows={4} value={texto} disabled={!canEdit} onChange={(e) => setTexto(e.target.value)} />
      <p className="text-xs text-muted-foreground">
        Marcadores:{' '}
        {p.marcadores.map((m) => <code key={m.clave} title={m.descripcion} className="mr-1 rounded bg-muted px-1">{`{${m.clave}}`}</code>)}
      </p>
      {desconocidos.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          No se reconocen {desconocidos.map((d) => `{${d}}`).join(', ')}: saldrán tal cual en el mensaje.
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={saving || texto.trim() === p.base} onClick={() => setTexto(p.base)}>Usar texto base</Button>
          <Button size="sm" disabled={saving || !cambiado} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      )}
    </div>
  );
}

/** Ajustes generales del módulo: custodia de la matrícula por defecto, exigir
 *  garante y los mensajes de WhatsApp de la cobranza. */
export function GeneralTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { ajustes, loading, guardar } = useMotosAjustes();

  const cambiar = async (campo: Interruptor['campo'], valor: boolean) => {
    try {
      await guardar({ [campo]: valor });
      toast({ title: 'Guardado' });
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    }
  };

  const fila = (i: Interruptor) => (
    <div key={i.campo} className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <Label htmlFor={`motos-${i.campo}`} className="font-medium">{i.titulo}</Label>
        <p className="text-xs text-muted-foreground">{i.ayuda}</p>
      </div>
      <Switch id={`motos-${i.campo}`} checked={ajustes[i.campo]} disabled={!canEdit || loading}
        onCheckedChange={(v) => cambiar(i.campo, v)} />
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Matrícula en custodia</CardTitle>
          <CardDescription>Qué pasa con la matrícula de la moto según cómo se vende o se presta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">{CUSTODIA.map(fila)}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Garante</CardTitle>
          <CardDescription>Los garantes se agregan en el expediente del cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          {fila({
            campo: 'requireGuarantor',
            titulo: 'Exigir garante para financiar o prestar',
            ayuda: 'Sin al menos un garante no se puede prestar ni vender una moto a crédito o financiada. Las refinanciaciones no lo piden.',
          })}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Mensajes de WhatsApp</CardTitle>
          <CardDescription>
            Los textos que abre WhatsApp ya escritos. Los marcadores entre llaves se cambian por los datos de cada cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {PLANTILLAS.map((p) => (
            <PlantillaMensaje key={p.campo} p={p} valor={ajustes[p.campo]} canEdit={canEdit && !loading}
              onGuardar={async (texto) => {
                try {
                  await guardar({ [p.campo]: texto });
                  toast({ title: 'Mensaje guardado' });
                } catch (e: any) {
                  toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
                }
              }} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
