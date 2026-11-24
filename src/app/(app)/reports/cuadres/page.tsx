'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { PeriodoSelector, type Rango } from '@/components/motos/cobranza/periodo-selector';
import { useCobranza } from '@/hooks/use-cobranza';
import { supabase } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { rowToEntrega } from '@/lib/supabase/mappers';
import { rangoDelPeriodo, resumenDeEntregas } from '@/lib/cobranza';
import { hoyLocal } from '@/lib/subscription-status';
import { cn, formatCurrency } from '@/lib/utils';
import type { EntregaDeCobrador } from '@/lib/types';

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });

// Las entregas de los cobradores de la sucursal activa en un período: totales
// por cobrador (esperado, recibido y diferencia) y el detalle.
export default function ReporteCuadresPage() {
  const { branchId, cobradores } = useCobranza();
  const [rango, setRango] = useState<Rango>(() => rangoDelPeriodo('mes', hoyLocal()));
  const [entregas, setEntregas] = useState<EntregaDeCobrador[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    // Días locales completos: desde las 00:00 del primero hasta antes de las 00:00 del siguiente al último.
    const desde = new Date(`${rango.desde}T00:00:00`).toISOString();
    const hastaD = new Date(`${rango.hasta}T00:00:00`);
    hastaD.setDate(hastaD.getDate() + 1);
    try {
      const filas = await fetchAllRows((d, h) => supabase.from('collector_settlements').select('*').eq('branch_id', branchId)
        .gte('created_at', desde).lt('created_at', hastaD.toISOString()).order('created_at', { ascending: false }).range(d, h));
      setEntregas(filas.map(rowToEntrega));
    } catch (e: any) {
      setError(e?.message ?? 'No se pudieron traer las entregas.');
      setEntregas([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, rango.desde, rango.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const nombre = (id: string) => cobradores.find((c) => c.id === id)?.name ?? 'Cobrador';
  const porCobrador = useMemo(() => resumenDeEntregas(entregas), [entregas]);
  const total = resumenDeEntregas(entregas.map((e) => ({ ...e, collectorId: 'total' })))[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Cuadres de Cobradores">
          <ExportButton
            filename="cuadres_de_cobradores"
            rows={entregas}
            columns={[
              { header: 'Fecha', value: (e) => new Date(e.createdAt).toLocaleString('es-DO') },
              { header: 'Cobrador', value: (e) => nombre(e.collectorId) },
              { header: 'Esperado (RD$)', value: (e) => e.expected },
              { header: 'Recibido (RD$)', value: (e) => e.received },
              { header: 'Diferencia (RD$)', value: (e) => e.difference },
              { header: 'Nota', value: (e) => e.note ?? '' },
              { header: 'Recibió', value: (e) => e.receivedByName ?? '' },
            ]}
          />
        </PageHeader>
        <PeriodoSelector value={rango} onChange={setRango} />
      </div>

      {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por cobrador · del {fechaCorta(rango.desde)} al {fechaCorta(rango.hasta)}</CardTitle>
          <CardDescription>La diferencia queda a cargo del cobrador; el sistema no la cobra ni la descuenta.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrador</TableHead>
                <TableHead className="text-right">Entregas</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Recibido</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Cargando…</TableCell></TableRow>}
              {!loading && porCobrador.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No hubo entregas en el período.</TableCell></TableRow>
              )}
              {porCobrador.map((f) => (
                <TableRow key={f.collectorId}>
                  <TableCell className="font-medium">{nombre(f.collectorId)}</TableCell>
                  <TableCell className="text-right">{f.entregas}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.esperado)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.recibido)}</TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap', f.diferencia < 0 && 'text-destructive')}>
                    {f.diferencia === 0 ? '—' : formatCurrency(f.diferencia)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {total && (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{total.entregas}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.esperado)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.recibido)}</TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap', total.diferencia < 0 && 'text-destructive')}>
                    {total.diferencia === 0 ? '—' : formatCurrency(total.diferencia)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalle</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cobrador</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Recibido</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead>Recibió</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entregas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{fechaHora(e.createdAt)}</TableCell>
                  <TableCell>{nombre(e.collectorId)}{e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(e.expected)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(e.received)}</TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap', e.difference < 0 && 'text-destructive')}>
                    {e.difference === 0 ? '—' : formatCurrency(e.difference)}
                  </TableCell>
                  <TableCell>{e.receivedByName ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
