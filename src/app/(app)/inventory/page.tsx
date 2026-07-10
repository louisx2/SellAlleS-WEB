'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ProductDataTable } from '@/components/products/product-data-table';
import { productColumns } from '@/components/products/product-columns';
import { ProductDialog } from '@/components/products/product-dialog';
import { ImportProductsDialog } from '@/components/products/import-products-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, Package, Tag, Coins, Upload, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProducts } from '@/context/product-provider';
import { useCategories } from '@/context/category-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useLocations } from '@/context/location-provider';
import { formatCurrency } from '@/lib/utils';
import { buildExportCsv, downloadTextFile } from '@/lib/inventory-csv';
import { useToast } from '@/hooks/use-toast';

export default function InventoryPage() {
  const { products } = useProducts();
  const { categories } = useCategories();
  const { suppliers } = useSuppliers();
  const { locations } = useLocations();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);

  const differentItems = products.length;
  const totalStock = products.reduce((acc, product) => acc + product.stock, 0);
  const totalInvestment = products.reduce((acc, product) => acc + (product.cost * product.stock), 0);

  const handleExport = () => {
    if (products.length === 0) {
      toast({ title: 'Inventario vacío', description: 'No hay productos para exportar.' });
      return;
    }
    const csv = buildExportCsv(products, categories, suppliers, locations);
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`inventario_${date}.csv`, csv);
    toast({ title: 'Inventario exportado', description: `${products.length} productos descargados en CSV.` });
  };

  return (
    <div>
      <PageHeader title="Administrar Inventario">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Importar
          </Button>
          <ProductDialog>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir Producto
            </Button>
          </ProductDialog>
        </div>
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

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
