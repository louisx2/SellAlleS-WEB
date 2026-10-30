'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useProducts } from '@/context/product-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity, roundQty } from '@/lib/units';
import { topProductKey } from '@/lib/quick-sales';
import { lineBaseQty } from '@/lib/presentations';
import { BarChart } from 'lucide-react';
import { ExportButton } from '@/components/reports/export-button';
import { SalesChart } from '@/components/reports/sales-chart';

export default function TopProductsReportPage() {
  const { sales: salesRaw } = useSales();
  // Las ventas anuladas no cuentan en la rotación de productos.
  const sales = useMemo(() => salesRaw.filter((s) => !s.cancelledAt), [salesRaw]);
  const { products } = useProducts();

  const topProducts = useMemo(() => {
    // La unidad se arrastra desde la línea vendida para poder mostrar "12.5 lb"
    // y no un "12.5" suelto. Ojo: el ranking suma cantidades de unidades
    // distintas, así que compara libras con cajas; ordenar por ingreso sería lo
    // correcto, mostrar la unidad al menos lo hace evidente.
    //
    // `name` es el de la primera línea que se vio: las rápidas no tienen producto
    // de catálogo y el reporte las nombra por lo que se escribió al venderlas.
    const productSales = new Map<string, { name: string; isQuick: boolean; quantity: number; revenue: number; unit?: string }>();

    sales.forEach(sale => {
      sale.items.forEach(item => {
        // Una rápida se agrupa por su descripción normalizada (`rapido:cable usb`).
        // Las líneas sin producto emparejado (importadas del legacy) también
        // llegan sin id: se agrupan por nombre para que no se mezclen todas en
        // una sola fila con el nombre de la primera.
        const key = topProductKey(item) || `sin-id:${item.product.name}`;
        const currentSales = productSales.get(key) || {
          name: item.product.name,
          isQuick: !!item.isQuick,
          quantity: 0,
          revenue: 0,
          unit: item.product.unit,
        };
        const price = item.customPrice ?? item.product.price;
        productSales.set(key, {
          ...currentSales,
          // Las unidades se cuentan en la base del producto (2 paquetes de 12 son 24),
          // para que el ranking y la unidad mostrada coincidan. El ingreso no cambia:
          // el precio de la línea ya es el de la presentación.
          quantity: roundQty(currentSales.quantity + lineBaseQty(item)),
          revenue: currentSales.revenue + (price * item.quantity),
          unit: currentSales.unit ?? item.product.unit,
        });
      });
    });
    
    return Array.from(productSales.entries())
      .map(([key, { name, ...data }]) => {
        // El nombre del catálogo manda si el producto existe (puede haberse
        // renombrado desde la venta); si no, el que quedó en la línea.
        const product = products.find(p => p.id === key);
        return {
          key,
          productName: product?.name || name,
          ...data,
        };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10); // Top 10 products

  }, [sales, products]);

  const chartData = topProducts.slice(0, 8).map((p) => ({ name: p.productName, total: p.quantity }));

  return (
    <div>
      <PageHeader title="Reporte de Productos Más Vendidos">
        <ExportButton
          filename="productos_mas_vendidos"
          rows={topProducts}
          columns={[
            { header: 'Producto', value: (p) => p.productName },
            { header: 'Cantidad vendida', value: (p) => formatQuantity(p.quantity, p.unit) },
            { header: 'Ingresos', value: (p) => p.revenue },
          ]}
        />
      </PageHeader>

      {chartData.length > 0 && (
        <Card className="mb-6 min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Top 8 por unidades vendidas</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={chartData} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart className="h-5 w-5" />
            <span>Ranking de Productos por Unidades Vendidas</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad Vendida</TableHead>
                <TableHead className="text-right">Ingresos Generados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.length > 0 ? (
                topProducts.map((p, index) => (
                  <TableRow key={p.key}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>
                      {p.productName}
                      {p.isQuick && <Badge variant="outline" className="ml-2 text-xs">Rápida</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatQuantity(p.quantity, p.unit)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.revenue)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No hay suficientes datos de ventas para generar un ranking.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

    