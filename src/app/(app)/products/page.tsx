'use client';

import { PageHeader } from '@/components/page-header';
import { ProductDataTable } from '@/components/products/product-data-table';
import { productColumns } from '@/components/products/product-columns';
import { ProductDialog } from '@/components/products/product-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProducts } from '@/context/product-provider';

export default function ProductsPage() {
  const { products } = useProducts();
  const totalStock = products.reduce((acc, product) => acc + product.stock, 0);

  return (
    <div>
      <PageHeader title="Administrar Productos">
        <ProductDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Producto
          </Button>
        </ProductDialog>
      </PageHeader>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Inventario Total</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalStock}</div>
          <p className="text-xs text-muted-foreground">unidades en total</p>
        </CardContent>
      </Card>

      <ProductDataTable columns={productColumns} data={products} />
    </div>
  );
}
