'use client';

import { PageHeader } from '@/components/page-header';
import { CustomerDataTable } from '@/components/customers/customer-data-table';
import { customerColumns } from '@/components/customers/customer-columns';
import { CustomerDialog } from '@/components/customers/customer-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useCustomers } from '@/context/customer-provider';

export default function CustomersPage() {
  const { customers } = useCustomers();

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
      <CustomerDataTable columns={customerColumns} data={customers} />
    </div>
  );
}
