'use client';

import { PageHeader } from '@/components/page-header';
import { useSuppliers } from '@/context/supplier-provider';
import { SupplierDataTable } from '@/components/suppliers/supplier-data-table';
import { supplierColumns } from '@/components/suppliers/supplier-columns';
import { SupplierDialog } from '@/components/suppliers/supplier-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';

export default function SuppliersPage() {
  const { suppliers } = useSuppliers();

  return (
    <div>
      <PageHeader title="Administrar Proveedores">
        <SupplierDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Proveedor
          </Button>
        </SupplierDialog>
      </PageHeader>
      <SupplierDataTable columns={supplierColumns} data={suppliers} />
    </div>
  );
}
