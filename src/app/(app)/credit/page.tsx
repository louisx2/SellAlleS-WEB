'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useCustomers } from '@/context/customer-provider';
import { CreditDataTable } from '@/components/credit/credit-data-table';
import { creditColumns } from '@/components/credit/credit-columns';
import { PlusCircle } from 'lucide-react';

export default function CreditPage() {
  const { customers } = useCustomers();
  const customersWithCredit = customers.filter(c => c.creditBalance > 0);

  return (
    <div>
      <PageHeader title="Cuentas por Cobrar">
        {/* Las ventas a crédito se generan en el POS (método de pago "Crédito"). */}
        <Button asChild>
          <Link href="/pos">
            <PlusCircle className="mr-2 h-4 w-4" />
            Nueva venta a crédito
          </Link>
        </Button>
      </PageHeader>
      <CreditDataTable columns={creditColumns} data={customersWithCredit} />
    </div>
  );
}
