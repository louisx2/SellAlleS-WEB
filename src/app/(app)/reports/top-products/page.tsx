'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { BarChart, Loader2, Star } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { useProducts } from '@/context/product-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity } from '@/lib/units';
import { rankingProductos, type OrdenProductos } from '@/lib/estrellas';
import { ExportButton } from '@/components/reports/export-button';
import { SalesChart } from '@/components/reports/sales-chart';
import { FiltroPeriodo, rangoMesActual, useFiltroSucursal } from '@/components/reports/filtro-periodo';
import { useVentasPeriodo } from '@/hooks/use-ventas-periodo';

export default function TopProductsReportPage() {
  const [rango, setRango] = React.useState<DateRange | undefined>(rangoMesActual);
  const { branchId, setBranchId, esAdmin } = useFiltroSucursal();
  // Por ingreso por defecto: por cantidad compara libras con cajas.
  const [orden, setOrden] = React.useState<OrdenProductos>('ingresos');
  const { ventas, loading, error } = useVentasPeriodo({ rango, branchId, conItems: true });
  const { products } = useProducts();

  const nombres = React.useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const ranking = React.useMemo(
    () => rankingProductos(ventas, orden, (id) => nombres.get(id)),
    [ventas, orden, nombres],
  );
  const totalIngresos = React.useMemo(() => ranking.reduce((t, p) => t + p.ingresos, 0), [ranking]);
  const estrella = ranking[0];
  const chartData = ranking.slice(0, 8).map((p) => ({
    name: p.nombre,
    total: orden === 'cantidad' ? p.cantidad : p.ingresos,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Productos Estrella">
        <div className="flex flex-wrap items-center gap-2">
          <FiltroPeriodo rango={rango} onRango={setRango} branchId={branchId} onBranch={setBranchId} esAdmin={esAdmin} />
          <ExportButton
            filename="productos_estrella"
            rows={ranking}
            columns={[
              { header: 'Producto', value: (p) => p.nombre },
              { header: 'Cantidad vendida', value: (p) => formatQuantity(p.cantidad, p.unidad) },
              { header: 'Ingresos', value: (p) => p.ingresos },
              { header: 'Venta rapida', value: (p) => (p.isQuick ? 'Si' : 'No') },
            ]}
          />
        </div>
      </PageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && estrella && (
        <Card className="border-amber-300/60 bg-gradient-to-br from-amber-500/10 to-transparent">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Star className="h-4 w-4 fill-current" /> Producto estrella del período
            </CardDescription>
            <CardTitle className="text-2xl">{estrella.nombre}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatCurrency(estrella.ingresos)} en ventas · {formatQuantity(estrella.cantidad, estrella.unidad)} vendidos
            {totalIngresos > 0 && <> · {((estrella.ingresos / totalIngresos) * 100).toFixed(1)}% de los ingresos</>}
          </CardContent>
        </Card>
      )}

      {chartData.length > 0 && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">
              Top 8 por {orden === 'cantidad' ? 'cantidad vendida' : 'ingresos'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={chartData} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart className="h-5 w-5" />
              <span>Ranking de productos</span>
            </CardTitle>
            <CardDescription className="mt-1.5">
              Las ventas anuladas no cuentan. La cantidad va en la unidad base del producto (2 paquetes de 12 son 24).
            </CardDescription>
          </div>
          <Tabs value={orden} onValueChange={(v) => setOrden(v as OrdenProductos)}>
            <TabsList>
              <TabsTrigger value="ingresos">Por ingresos</TabsTrigger>
              <TabsTrigger value="cantidad">Por cantidad</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">#</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad vendida</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">% de ingresos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : ranking.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No hay ventas en este rango de fechas.
                    </TableCell>
                  </TableRow>
                ) : (
                  ranking.slice(0, 50).map((p, i) => (
                    <TableRow key={p.key}>
                      <TableCell className="font-medium">
                        {i < 3 ? <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-label={`Puesto ${i + 1}`} /> : i + 1}
                      </TableCell>
                      <TableCell>
                        {p.nombre}
                        {p.isQuick && <Badge variant="outline" className="ml-2 text-xs">Rápida</Badge>}
                      </TableCell>
                      <TableCell className={`text-right ${orden === 'cantidad' ? 'font-bold' : ''}`}>
                        {formatQuantity(p.cantidad, p.unidad)}
                      </TableCell>
                      <TableCell className={`text-right ${orden === 'ingresos' ? 'font-bold' : ''}`}>
                        {formatCurrency(p.ingresos)}
                      </TableCell>
                      <TableCell className="text-right">
                        {totalIngresos > 0 ? `${((p.ingresos / totalIngresos) * 100).toFixed(1)}%` : '—'}
                      </TableCell>
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
