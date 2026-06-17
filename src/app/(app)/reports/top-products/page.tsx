'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useProducts } from '@/context/product-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { BarChart } from 'lucide-react';

export default function TopProductsReportPage() {
  const { sales } = useSales();
  const { products } = useProducts();

  const topProducts = useMemo(() => {
    const productSales = new Map<string, { quantity: number; revenue: number }>();

    sales.forEach(sale => {
      sale.items.forEach(item => {
        const currentSales = productSales.get(item.product.id) || { quantity: 0, revenue: 0 };
        const price = item.customPrice ?? item.product.price;
        productSales.set(item.product.id, {
          quantity: currentSales.quantity + item.quantity,
          revenue: currentSales.revenue + (price * item.quantity),
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

  return (
    <div>
      <PageHeader title="Reporte de Productos Más Vendidos" />

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
                <TableHead className="text-right">Unidades Vendidas</TableHead>
                <TableHead className="text-right">Ingresos Generados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.length > 0 ? (
                topProducts.map((p, index) => (
                  <TableRow key={p.productName}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>{p.productName}</TableCell>
                    <TableCell className="text-right font-bold">{p.quantity}</TableCell>
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

    