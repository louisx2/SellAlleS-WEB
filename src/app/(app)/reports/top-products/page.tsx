'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useProducts } from '@/context/product-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity, roundQty } from '@/lib/units';
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
    const productSales = new Map<string, { quantity: number; revenue: number; unit?: string }>();

    sales.forEach(sale => {
      sale.items.forEach(item => {
        const currentSales = productSales.get(item.product.id) || { quantity: 0, revenue: 0, unit: item.product.unit };
        const price = item.customPrice ?? item.product.price;
        productSales.set(item.product.id, {
          quantity: roundQty(currentSales.quantity + item.quantity),
          revenue: currentSales.revenue + (price * item.quantity),
          unit: currentSales.unit ?? item.product.unit,
        });
      });
    });
    
    return Array.from(productSales.entries())
      .map(([productId, data]) => {
        const product = products.find(p => p.id === productId);
        return {
          productName: product?.name || 'Producto Desconocido',
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
                  <TableRow key={p.productName}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>{p.productName}</TableCell>
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

    