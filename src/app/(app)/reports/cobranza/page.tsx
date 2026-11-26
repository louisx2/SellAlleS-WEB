'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { PeriodoSelector, type Rango } from '@/components/motos/cobranza/periodo-selector';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { efectividad, rangoDelPeriodo } from '@/lib/cobranza';
import { hoyLocal } from '@/lib/subscription-status';
import { cn, formatCurrency } from '@/lib/utils';

type FilaCobrador = {
  collector_id: string; nombre: string; por_cobrar: number; cobrado: number; visitas: number;
  promesas_cumplidas: number; promesas_incumplidas: number; atrasados: number; en_mano: number; en_mano_desde: string | null;
};
type Reporte = { cobradores: FilaCobrador[]; sin_asignar: { por_cobrar: number; atrasados: number } };

const n = (v: unknown) => Number(v ?? 0);
const fechaCorta = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
const pct = (cobrado: number, porCobrar: number) => {
  const e = efectividad(cobrado, porCobrar);
  return e === null ? '—' : `${e}%`;
};

// Cobranza por cobrador en un período (sucursal activa), y el efectivo que cada
// uno tiene en mano ahora. Lo calcula la base (`cobranza_reporte`).
export default function ReporteCobranzaPage() {
  const { appUser } = useAuth();
  const branchId = appUser?.activeBranchId ?? '';
  const [rango, setRango] = useState<Rango>(() => rangoDelPeriodo('mes', hoyLocal()));
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('cobranza_reporte', { p_branch_id: branchId, p_desde: rango.desde, p_hasta: rango.hasta });
    if (e) { setError(e.message); setDatos(null); } else setDatos(data as Reporte);
    setLoading(false);
  }, [branchId, rango.desde, rango.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const filas = (datos?.cobradores ?? []).map((f) => ({
    ...f, por_cobrar: n(f.por_cobrar), cobrado: n(f.cobrado), en_mano: n(f.en_mano),
  }));
  const sinAsignar = { por_cobrar: n(datos?.sin_asignar?.por_cobrar), atrasados: n(datos?.sin_asignar?.atrasados) };
  const total = {
    porCobrar: filas.reduce((s, f) => s + f.por_cobrar, 0) + sinAsignar.por_cobrar,
    cobrado: filas.reduce((s, f) => s + f.cobrado, 0),
    visitas: filas.reduce((s, f) => s + n(f.visitas), 0),
    cumplidas: filas.reduce((s, f) => s + n(f.promesas_cumplidas), 0),
    incumplidas: filas.reduce((s, f) => s + n(f.promesas_incumplidas), 0),
    atrasados: filas.reduce((s, f) => s + n(f.atrasados), 0) + sinAsignar.atrasados,
  };
  const enMano = filas.filter((f) => f.en_mano > 0);
  // Efectivo que no se entregó el mismo día: se resalta.
  const hoy = hoyLocal();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Cobranza por Cobrador">
          <ExportButton
            filename="cobranza_por_cobrador"
            rows={filas}
            columns={[
              { header: 'Cobrador', value: (f) => f.nombre },
              { header: 'Por cobrar (RD$)', value: (f) => f.por_cobrar },
              { header: 'Cobrado (RD$)', value: (f) => f.cobrado },
              { header: 'Efectividad', value: (f) => pct(f.cobrado, f.por_cobrar) },
              { header: 'Visitas', value: (f) => n(f.visitas) },
              { header: 'Promesas cumplidas', value: (f) => n(f.promesas_cumplidas) },
              { header: 'Promesas incumplidas', value: (f) => n(f.promesas_incumplidas) },
              { header: 'Clientes atrasados', value: (f) => n(f.atrasados) },
              { header: 'En mano (RD$)', value: (f) => f.en_mano },
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
            Por cobrar: lo que vencía en el período en las cuotas de la cartera de cada cobrador. Cobrado: sus abonos del período.
            Las promesas cuentan cuando ya pasó su fecha.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrador</TableHead>
                <TableHead className="text-right">Por cobrar</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Efectividad</TableHead>
                <TableHead className="text-right">Visitas</TableHead>
                <TableHead className="text-right">Promesas</TableHead>
                <TableHead className="text-right">Atrasados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Cargando…</TableCell></TableRow>}
              {!loading && filas.map((f) => (
                <TableRow key={f.collector_id}>
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.por_cobrar)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.cobrado)}</TableCell>
                  <TableCell className="text-right">{pct(f.cobrado, f.por_cobrar)}</TableCell>
                  <TableCell className="text-right">{n(f.visitas)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <span className="text-emerald-700 dark:text-emerald-300">{n(f.promesas_cumplidas)} cumplidas</span>
                    {' · '}
                    <span className={n(f.promesas_incumplidas) > 0 ? 'text-destructive' : undefined}>{n(f.promesas_incumplidas)} no</span>
                  </TableCell>
                  <TableCell className="text-right">{n(f.atrasados)}</TableCell>
                </TableRow>
              ))}
              {!loading && (
                <TableRow>
                  <TableCell className="text-muted-foreground">Sin asignar</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(sinAsignar.por_cobrar)}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right">—</TableCell>
                  <TableCell className="text-right">{sinAsignar.atrasados}</TableCell>
                </TableRow>
              )}
            </TableBody>
            {!loading && (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.porCobrar)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(total.cobrado)}</TableCell>
                  <TableCell className="text-right">{pct(total.cobrado, total.porCobrar)}</TableCell>
                  <TableCell className="text-right">{total.visitas}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{total.cumplidas} cumplidas · {total.incumplidas} no</TableCell>
                  <TableCell className="text-right">{total.atrasados}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">En mano ahora</CardTitle>
          <CardDescription>Efectivo cobrado en la calle que todavía no se ha entregado.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrador</TableHead>
                <TableHead className="text-right">En mano</TableHead>
                <TableHead className="text-right">Desde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && enMano.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">Nadie tiene efectivo sin entregar.</TableCell></TableRow>
              )}
              {enMano.map((f) => {
                const viejo = !!f.en_mano_desde && f.en_mano_desde < hoy;
                return (
                  <TableRow key={f.collector_id}>
                    <TableCell className="font-medium">{f.nombre}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.en_mano)}</TableCell>
                    <TableCell className={cn('text-right', viejo && 'font-medium text-destructive')}>
                      {f.en_mano_desde ? fechaCorta(f.en_mano_desde) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
