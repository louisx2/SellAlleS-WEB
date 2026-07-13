'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { useProducts } from '@/context/product-provider';
import { useCategories } from '@/context/category-provider';
import { ExportButton } from '@/components/reports/export-button';
import { Package, Coins, TrendingUp, AlertTriangle } from 'lucide-react';

const LOW_STOCK_THRESHOLD = 5;

// Reporte de valorización de inventario: valor a costo, valor a precio de venta,
// margen potencial, y productos con bajo stock.
export default function InventoryReportPage() {
  const { products } = useProducts();
  const { categories } = useCategories();

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const rows = useMemo(() =>
    products.map((p) => ({
      name: p.name,
      code: p.code,
      category: p.categoryId ? catName.get(p.categoryId) ?? '' : '',
      stock: p.stock,
      cost: p.cost,
      price: p.price,
      costValue: p.cost * p.stock,
      saleValue: p.price * p.stock,
      lowStock: p.stock <= LOW_STOCK_THRESHOLD,
    })).sort((a, b) => b.costValue - a.costValue),
  [products, catName]);

  const totals = useMemo(() => ({
    costValue: rows.reduce((a, r) => a + r.costValue, 0),
    saleValue: rows.reduce((a, r) => a + r.saleValue, 0),
    units: rows.reduce((a, r) => a + r.stock, 0),
    lowStock: rows.filter((r) => r.lowStock).length,
  }), [rows]);

  const margin = totals.saleValue - totals.costValue;

  return (
    <div>
      <PageHeader title="Valorización de Inventario">
        <ExportButton
          filename="valorizacion_inventario"
          rows={rows}
          columns={[
            { header: 'Código', value: (r) => r.code },
            { header: 'Producto', value: (r) => r.name },
            { header: 'Categoría', value: (r) => r.category },
            { header: 'Existencias', value: (r) => r.stock },
            { header: 'Costo unitario', value: (r) => r.cost },
            { header: 'Precio venta', value: (r) => r.price },
            { header: 'Valor a costo', value: (r) => r.costValue },
            { header: 'Valor a venta', value: (r) => r.saleValue },
          ]}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor a costo</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.costValue)}</div>
            <p className="text-xs text-muted-foreground">{totals.units} unidades</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor a venta</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.saleValue)}</div>
            <p className="text-xs text-muted-foreground">si se vende todo</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Margen potencial</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(margin)}</div>
            <p className="text-xs text-muted-foreground">ganancia bruta esperada</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bajo stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.lowStock}</div>
            <p className="text-xs text-muted-foreground">≤ {LOW_STOCK_THRESHOLD} unidades</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Detalle por producto</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Existencias</TableHead>
                  <TableHead className="text-right">Valor a costo</TableHead>
                  <TableHead className="text-right">Valor a venta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? rows.map((r, i) => (
                  <TableRow key={`${r.code}-${i}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.category || '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.stock}
                      {r.lowStock && <Badge variant="destructive" className="ml-2 text-[10px] h-4 px-1">Bajo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(r.costValue)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.saleValue)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="h-24 text-center">No hay productos en el inventario.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
