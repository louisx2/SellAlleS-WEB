'use client';

import { PageHeader } from '@/components/page-header';
import { useSuppliers } from '@/context/supplier-provider';
import { SupplierDataTable } from '@/components/suppliers/supplier-data-table';
import { supplierColumns } from '@/components/suppliers/supplier-columns';

export default function SuppliersPage() {
  const { suppliers } = useSuppliers();

  return (
    <div>
      <PageHeader title="Administrar Proveedores" />
      <SupplierDataTable columns={supplierColumns} data={suppliers} />
    </div>
  );
}
