'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useCustomers } from '@/context/customer-provider';
import { CreditDataTable } from '@/components/credit/credit-data-table';
import { creditColumns } from '@/components/credit/credit-columns';

export default function CreditPage() {
  const { customers } = useCustomers();
  const customersWithCredit = customers.filter(c => c.creditBalance > 0);

  return (
    <div>
      <PageHeader title="Cuentas por Cobrar" />
      <CreditDataTable columns={creditColumns} data={customersWithCredit} />
    </div>
  );
}
