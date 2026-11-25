'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { PeriodoSelector, type Rango } from '@/components/motos/cobranza/periodo-selector';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { rowToVehicleRecovery } from '@/lib/supabase/mappers';
import { rangoDelPeriodo } from '@/lib/cobranza';
import { vehicleLabel } from '@/lib/motos';
import { recuperadoDe, resultadoDeRecuperacion, TEXTO_ESTADO_RECUPERACION } from '@/lib/motos-recuperacion';
import { hoyLocal } from '@/lib/subscription-status';
import { cn, formatCurrency } from '@/lib/utils';
import type { VehicleRecovery } from '@/lib/types';

// Embeds por la FK exacta: vehicle_recoveries apunta también a companies y
// branches, igual que vehicles, sales y loans.
const SELECT =
  '*, vehicles!vehicle_recoveries_vehicle_id_fkey(brand, model, year, color, chassis), '
  + 'sales!vehicle_recoveries_sale_id_fkey(customers(name)), '
  + 'loans!vehicle_recoveries_loan_id_fkey(customers(name))';

type Fila = VehicleRecovery & {
  moto: string;
  chasis: string;
  cliente: string;
  recuperado: number;
  resultado: number;
};

const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });

const tipoDe = (r: VehicleRecovery) =>
  r.kind === 'venta' ? 'Venta recuperada'
    : r.liquidationMode === 'dacion' ? 'Garantía · dación en pago'
      : r.liquidationMode === 'tercero' ? 'Garantía · vendida a un tercero'
        : 'Garantía';

const centavos = (n: number) => Math.round(n * 100) / 100;

// Recuperaciones de motos de la sucursal activa en un período (por la fecha de la
// recuperación): lo que se debía, lo recuperado, lo dado de baja, lo devuelto al
// cliente y el resultado.
export default function ReporteRecuperacionesPage() {
  const { appUser } = useAuth();
  const branchId = appUser?.activeBranchId;
  const [rango, setRango] = useState<Rango>(() => rangoDelPeriodo('mes', hoyLocal()));
  const [filas, setFilas] = useState<Fila[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const datos = await fetchAllRows((d, h) => supabase.from('vehicle_recoveries').select(SELECT).eq('branch_id', branchId)
        .gte('recovered_on', rango.desde).lte('recovered_on', rango.hasta)
        .order('recovered_on', { ascending: false }).order('created_at', { ascending: false }).range(d, h));
      setFilas(datos.map((row: any) => {
        const r = rowToVehicleRecovery(row);
        const v = row.vehicles ?? {};
        const recuperado = recuperadoDe(r);
        return {
          ...r,
          moto: vehicleLabel(v),
          chasis: v.chassis ?? '',
          cliente: row.sales?.customers?.name ?? row.loans?.customers?.name ?? '—',
          recuperado,
          resultado: resultadoDeRecuperacion({ recuperado, dadoDeBaja: r.writtenOff, devuelto: r.refunded }),
        };
      }));
    } catch (e: any) {
      setError(e?.message ?? 'No se pudieron traer las recuperaciones.');
      setFilas([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, rango.desde, rango.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const total = useMemo(() => filas.reduce(
    (t, f) => ({
      deuda: centavos(t.deuda + (f.debtAtRecovery ?? 0)),
      recuperado: centavos(t.recuperado + f.recuperado),
      dadoDeBaja: centavos(t.dadoDeBaja + f.writtenOff),
      devuelto: centavos(t.devuelto + f.refunded),
      resultado: centavos(t.resultado + f.resultado),
    }),
    { deuda: 0, recuperado: 0, dadoDeBaja: 0, devuelto: 0, resultado: 0 },
  ), [filas]);

  const dinero = (n: number) => (n === 0 ? '—' : formatCurrency(n));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Recuperaciones de Motos">
          <ExportButton
            filename="recuperaciones_de_motos"
            rows={filas}
            columns={[
              { header: 'Fecha', value: (f) => f.recoveredOn },
              { header: 'Moto', value: (f) => f.moto },
              { header: 'Chasis', value: (f) => f.chasis },
              { header: 'Cliente', value: (f) => f.cliente },
              { header: 'Tipo', value: (f) => tipoDe(f) },
              { header: 'Estado', value: (f) => TEXTO_ESTADO_RECUPERACION[f.status] },
              { header: 'Motivo', value: (f) => f.reason ?? '' },
              { header: 'Deuda al recuperar (RD$)', value: (f) => f.debtAtRecovery ?? 0 },
              { header: 'Recuperado (RD$)', value: (f) => f.recuperado },
              { header: 'Dado de baja (RD$)', value: (f) => f.writtenOff },
              { header: 'Devuelto (RD$)', value: (f) => f.refunded },
              { header: 'Resultado (RD$)', value: (f) => f.resultado },
            ]}
          />
        </PageHeader>
        <PeriodoSelector value={rango} onChange={setRango} />
      </div>

      {error && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Del {fechaCorta(rango.desde)} al {fechaCorta(rango.hasta)}</CardTitle>
          <CardDescription>
            Resultado = recuperado − dado de baja − devuelto. Una moto incautada todavía no recupera nada: cuenta cuando se liquida.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Moto</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Deuda al recuperar</TableHead>
                <TableHead className="text-right">Recuperado</TableHead>
                <TableHead className="text-right">Dado de baja</TableHead>
                <TableHead className="text-right">Devuelto</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground">Cargando…</TableCell></TableRow>}
              {!loading && filas.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground">No hubo recuperaciones en el período.</TableCell></TableRow>
              )}
              {!loading && filas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap">{fechaCorta(f.recoveredOn)}</TableCell>
                  <TableCell>
                    <Link href={`/motos/ficha?id=${f.vehicleId}`} className="font-medium underline-offset-2 hover:underline">{f.moto}</Link>
                    {f.chasis && <p className="font-mono text-xs text-muted-foreground">{f.chasis}</p>}
                  </TableCell>
                  <TableCell>{f.cliente}</TableCell>
                  <TableCell>{tipoDe(f)}{f.reason && <p className="text-xs text-muted-foreground">{f.reason}</p>}</TableCell>
                  <TableCell>{TEXTO_ESTADO_RECUPERACION[f.status]}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{f.debtAtRecovery != null ? formatCurrency(f.debtAtRecovery) : '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{dinero(f.recuperado)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{dinero(f.writtenOff)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{dinero(f.refunded)}</TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap font-medium', f.resultado < 0 && 'text-destructive')}>{dinero(f.resultado)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {!loading && filas.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5}>Total · {filas.length} {filas.length === 1 ? 'recuperación' : 'recuperaciones'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.deuda)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.recuperado)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.dadoDeBaja)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.devuelto)}</TableCell>
                  <TableCell className={cn('text-right whitespace-nowrap', total.resultado < 0 && 'text-destructive')}>{formatCurrency(total.resultado)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
