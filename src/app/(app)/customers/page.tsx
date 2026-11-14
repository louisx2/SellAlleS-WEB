'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { CustomerDataTable } from '@/components/customers/customer-data-table';
import { buildCustomerColumns } from '@/components/customers/customer-columns';
import { CustomerDialog } from '@/components/customers/customer-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useCustomers } from '@/context/customer-provider';
import { useSales } from '@/context/sales-provider';
import { idsClientesEstrella } from '@/lib/estrellas';

export default function CustomersPage() {
  const { customers } = useCustomers();
  // La estrella sale de las ventas que ya tiene el provider (sucursal activa,
  // las más recientes): alcanza para los últimos 90 días de un negocio normal.
  // El ranking completo, de cualquier rango y sucursal, está en Reportes.
  const { sales } = useSales();
  const columns = useMemo(() => buildCustomerColumns(idsClientesEstrella(sales)), [sales]);

  return (
    <div>
      <PageHeader title="Administrar Clientes">
        <CustomerDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Cliente
          </Button>
        </CustomerDialog>
      </PageHeader>
      <CustomerDataTable columns={columns} data={customers} />
    </div>
  );
}
