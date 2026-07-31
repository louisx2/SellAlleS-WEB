'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ProductDataTable } from '@/components/products/product-data-table';
import { productColumns } from '@/components/products/product-columns';
import { ProductDialog } from '@/components/products/product-dialog';
import { ImportProductsDialog } from '@/components/products/import-products-dialog';
import { ArchivedProductsDialog } from '@/components/products/archived-products-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlusCircle, Package, Tag, Coins, Upload, Download, MoreVertical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProducts } from '@/context/product-provider';
import { useCategories } from '@/context/category-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useLocations } from '@/context/location-provider';
import { formatCurrency } from '@/lib/utils';
import { formatQty } from '@/lib/units';
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
  // Los productos sin inventario (platos, servicios) no suman existencias ni
  // inversión: su stock es siempre 0 y no representa mercancía en almacén.
  const stocked = products.filter((p) => p.tracksStock);
  const totalStock = stocked.reduce((acc, product) => acc + product.stock, 0);
  const totalInvestment = stocked.reduce((acc, product) => acc + (product.cost * product.stock), 0);

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
        <div className="flex items-center gap-2">
          {/* En pantalla ancha: botones sueltos. En móvil: colapsados en un menú
              de 3 puntos para no amontonar la cabecera. */}
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar
            </Button>
            {/* Los artículos con ventas no se borran, se archivan: desde aquí se
                ven y se recuperan. */}
            <ArchivedProductsDialog />
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" /> Exportar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" /> Importar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ProductDialog>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Añadir Producto</span>
              <span className="sm:hidden">Añadir</span>
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
            <div className="text-2xl font-bold">{formatQty(totalStock)}</div>
            {/* Se suman existencias de unidades distintas (libras + cajas…):
                es un conteo bruto, no una magnitud comparable. */}
            <p className="text-xs text-muted-foreground">suma de existencias (unidades mixtas)</p>
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
