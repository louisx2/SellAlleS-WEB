'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Loader2, Star } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { SalesChart } from '@/components/reports/sales-chart';
import { FiltroPeriodo, rangoMesActual, useFiltroSucursal } from '@/components/reports/filtro-periodo';
import { useVentasPeriodo } from '@/hooks/use-ventas-periodo';
import { formatCurrency } from '@/lib/utils';
import { rankingClientes } from '@/lib/estrellas';

export default function TopCustomersReportPage() {
  const [rango, setRango] = React.useState<DateRange | undefined>(rangoMesActual);
  const { branchId, setBranchId, esAdmin } = useFiltroSucursal();
  const { ventas, loading, error } = useVentasPeriodo({ rango, branchId, conItems: false });

  const ranking = React.useMemo(() => rankingClientes(ventas), [ventas]);
  const totalVendido = React.useMemo(() => ranking.reduce((t, c) => t + c.monto, 0), [ranking]);
  const estrella = ranking[0];
  const chartData = ranking.slice(0, 8).map((c) => ({ name: c.nombre, total: c.monto }));
  const pct = (monto: number) => (totalVendido > 0 ? (monto / totalVendido) * 100 : 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Clientes Estrella">
        <div className="flex flex-wrap items-center gap-2">
          <FiltroPeriodo rango={rango} onRango={setRango} branchId={branchId} onBranch={setBranchId} esAdmin={esAdmin} />
          <ExportButton
            filename="clientes_estrella"
            rows={ranking}
            columns={[
              { header: 'Cliente', value: (c) => c.nombre },
              { header: 'Compras', value: (c) => c.compras },
              { header: 'Monto comprado', value: (c) => c.monto },
              { header: 'Ticket promedio', value: (c) => c.ticketPromedio },
              { header: 'Ultima compra', value: (c) => format(c.ultimaCompra, 'yyyy-MM-dd') },
            ]}
          />
        </div>
      </PageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && estrella && (
        <Card className="border-amber-300/60 bg-gradient-to-br from-amber-500/10 to-transparent">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Star className="h-4 w-4 fill-current" /> Cliente estrella del período
            </CardDescription>
            <CardTitle className="text-2xl">
              <Link href={`/customers/history?id=${estrella.customerId}`} className="hover:underline">
                {estrella.nombre}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatCurrency(estrella.monto)} en {estrella.compras} compra{estrella.compras === 1 ? '' : 's'}
            {' · '}{pct(estrella.monto).toFixed(1)}% de lo vendido a clientes identificados
          </CardContent>
        </Card>
      )}

      {chartData.length > 0 && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Top 8 por monto comprado</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={chartData} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ranking de clientes</CardTitle>
          <CardDescription>
            Ordenado por lo que compró cada cliente en el período, con ITBIS. Las ventas anuladas y las del
            Cliente Genérico no cuentan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Ticket prom.</TableHead>
                  <TableHead className="text-right">% del total</TableHead>
                  <TableHead className="text-right">Última compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : ranking.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      No hay ventas a clientes identificados en este rango.
                    </TableCell>
                  </TableRow>
                ) : (
                  ranking.slice(0, 50).map((c, i) => (
                    <TableRow key={c.customerId}>
                      <TableCell className="font-medium">
                        {i < 3 ? <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-label={`Puesto ${i + 1}`} /> : i + 1}
                      </TableCell>
                      <TableCell>
                        <Link href={`/customers/history?id=${c.customerId}`} className="font-medium hover:underline">
                          {c.nombre}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{c.compras}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(c.monto)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(c.ticketPromedio)}</TableCell>
                      <TableCell className="text-right">{pct(c.monto).toFixed(1)}%</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{format(c.ultimaCompra, 'd LLL y', { locale: es })}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {ranking.length > 50 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Se muestran los 50 primeros de {ranking.length}. El CSV los trae todos.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
