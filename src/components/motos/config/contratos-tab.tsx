'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useMotosAjustes } from '@/hooks/use-motos-ajustes';
import { CONTRATO_BASE, MARCADORES, llenarContrato, marcadoresDesconocidos, type TipoContrato } from '@/lib/contrato';
import { ContratoDocumento } from '@/components/motos/contrato-documento';

const TITULO: Record<TipoContrato, string> = { venta: 'Venta condicional', prestamo: 'Préstamo con garantía' };

// Datos de ejemplo para la vista previa.
const EJEMPLO: Record<string, string> = {
  'empresa.nombre': 'Motos del Sur', 'empresa.rnc': '131-00000-1', 'empresa.direccion': 'Calle Duarte #10, Azua',
  'empresa.telefono': '809-555-0000', 'cliente.nombre': 'Juan Pérez', 'cliente.cedula': '010-0000000-1',
  'cliente.direccion': 'Pueblo Abajo, Azua', 'cliente.telefono': '809-555-0101', 'vehiculo.marca': 'Honda',
  'vehiculo.modelo': 'C70', 'vehiculo.año': '2024', 'vehiculo.color': 'Roja', 'vehiculo.chasis': 'LWBPCJ1F0P1000001',
  'vehiculo.motor': 'E-12345', 'vehiculo.placa': 'K123456', 'vehiculo.matricula': '1234567', monto: 'RD$95,000.00',
  inicial: 'RD$15,000.00', cuotas: '52', frecuencia: 'semanales', cuota: 'RD$1,923.08', tasa: '5%', total: 'RD$100,000.00',
  primera_cuota: '1/12/2026', fecha: '24/11/2026', garantes: 'Juana Pérez, cédula 001-0000000-1, tel. 809-555-0001',
};
const PLAN_EJEMPLO = [1, 2, 3].map((n) => ({ numero: n, fecha: `${n}/12/2026`, monto: 1923.08 }));

/** Los dos textos del contrato, con sus marcadores y una vista previa. */
export function ContratosTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { ajustes, loading, guardar } = useMotosAjustes();
  const [tipo, setTipo] = useState<TipoContrato>('venta');
  const [textos, setTextos] = useState<Record<TipoContrato, string>>({ venta: CONTRATO_BASE.venta, prestamo: CONTRATO_BASE.prestamo });
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // Al cargar los ajustes: lo guardado, o el texto base.
  useEffect(() => {
    if (loading) return;
    setTextos({ venta: ajustes.contractSale ?? CONTRATO_BASE.venta, prestamo: ajustes.contractLoan ?? CONTRATO_BASE.prestamo });
  }, [loading, ajustes.contractSale, ajustes.contractLoan]);

  const texto = textos[tipo];
  const desconocidos = useMemo(() => marcadoresDesconocidos(texto), [texto]);
  const segmentos = useMemo(() => llenarContrato(texto, EJEMPLO), [texto]);
  const guardado = (tipo === 'venta' ? ajustes.contractSale : ajustes.contractLoan) ?? CONTRATO_BASE[tipo];

  const insertar = (clave: string) => {
    const el = area.current;
    const marcador = `{${clave}}`;
    const ini = el?.selectionStart ?? texto.length;
    const fin = el?.selectionEnd ?? texto.length;
    setTextos((t) => ({ ...t, [tipo]: texto.slice(0, ini) + marcador + texto.slice(fin) }));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(ini + marcador.length, ini + marcador.length); });
  };

  const guardarTexto = async (valor: string | null) => {
    setSaving(true);
    try {
      // El texto base no se guarda: así una mejora futura del texto base les llega.
      const final = valor === null || valor.trim() === CONTRATO_BASE[tipo].trim() ? null : valor;
      await guardar(tipo === 'venta' ? { contractSale: final ?? undefined } : { contractLoan: final ?? undefined });
      if (valor === null) setTextos((t) => ({ ...t, [tipo]: CONTRATO_BASE[tipo] }));
      toast({ title: valor === null ? 'Texto base restaurado' : 'Contrato guardado' });
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tipo} onValueChange={(v) => setTipo(v as TipoContrato)}>
        <TabsList>
          <TabsTrigger value="venta">{TITULO.venta}</TabsTrigger>
          <TabsTrigger value="prestamo">{TITULO.prestamo}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Texto del contrato</CardTitle>
            <CardDescription>
              Los datos van entre llaves y se llenan solos al imprimir. Un dato que falte sale como raya para llenarlo a mano.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              ref={area}
              rows={22}
              className="font-mono text-xs"
              value={texto}
              readOnly={!canEdit}
              onChange={(e) => setTextos((t) => ({ ...t, [tipo]: e.target.value }))}
            />
            {desconocidos.length > 0 && (
              <p className="text-sm text-destructive">
                Estos marcadores no existen y saldrán tal cual: {desconocidos.join(', ')}
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => guardarTexto(texto)} disabled={saving || texto === guardado}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </Button>
                <Button variant="outline" onClick={() => guardarTexto(null)} disabled={saving}>Restaurar texto base</Button>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-medium">Marcadores {canEdit && <span className="text-muted-foreground">(clic para insertar)</span>}</p>
              <div className="flex flex-wrap gap-1">
                {MARCADORES.map((m) => (
                  <button
                    key={m.clave}
                    type="button"
                    title={m.descripcion}
                    disabled={!canEdit}
                    onClick={() => insertar(m.clave)}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent disabled:cursor-default"
                  >
                    {`{${m.clave}}`}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vista previa</CardTitle>
            <CardDescription>Con datos de ejemplo.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[70vh] overflow-auto rounded-md border bg-white text-black">
              <ContratoDocumento segmentos={segmentos} plan={PLAN_EJEMPLO} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
