'use client';

import { PageHeader } from '@/components/page-header';
import { ProductDataTable } from '@/components/products/product-data-table';
import { productColumns } from '@/components/products/product-columns';
import { ProductDialog } from '@/components/products/product-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, Package, Tag, Coins } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProducts } from '@/context/product-provider';
import { formatCurrency } from '@/lib/utils';

export default function InventoryPage() {
  const { products } = useProducts();
  const differentItems = products.length;
  const totalStock = products.reduce((acc, product) => acc + product.stock, 0);
  const totalInvestment = products.reduce((acc, product) => acc + (product.cost * product.stock), 0);

  return (
    <div>
      <PageHeader title="Administrar Inventario">
        <ProductDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Producto
          </Button>
        </ProductDialog>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artículos Diferentes</CardTitle>
            <Tag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{differentItems}</div>
            <p className="text-xs text-muted-foreground">productos en catálogo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Existencias Totales</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalStock}</div>
            <p className="text-xs text-muted-foreground">unidades físicas totales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invertido</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalInvestment)}</div>
            <p className="text-xs text-muted-foreground">costo total del inventario</p>
          </CardContent>
        </Card>
      </div>

      <ProductDataTable columns={productColumns} data={products} />
    </div>
  );
}
