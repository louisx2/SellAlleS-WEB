'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useMotosAjustes } from '@/hooks/use-motos-ajustes';
import type { MotosSettings } from '@/lib/types';

type Interruptor = { campo: keyof Pick<MotosSettings, 'custodyFinancedSale' | 'custodyCashSale' | 'custodyLoan' | 'requireGuarantor'>; titulo: string; ayuda: string };

const CUSTODIA: Interruptor[] = [
  { campo: 'custodyFinancedSale', titulo: 'Venta a crédito o financiada', ayuda: 'El negocio guarda la matrícula hasta que se salde la venta.' },
  { campo: 'custodyCashSale', titulo: 'Venta de contado', ayuda: 'Encendido: la matrícula queda «lista para entregar» (el negocio la tramita y la entrega después). Apagado: se entrega con la moto.' },
  { campo: 'custodyLoan', titulo: 'Préstamo con la moto en garantía', ayuda: 'Cómo arranca la opción «La matrícula queda en custodia» al prestar.' },
];

/** Ajustes generales del módulo: custodia de la matrícula por defecto y exigir garante. */
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
    </div>
  );
}
