'use client';

import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { FinancingDataTable } from '@/components/financing/financing-data-table';
import { financingColumns } from '@/components/financing/financing-columns';

export default function FinancingPage() {
  const { sales } = useSales();
  const financingSales = sales.filter(
    (sale) => sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing'
  );

  return (
    <div>
      <PageHeader title="Gestión de Financiamientos" />
      <FinancingDataTable columns={financingColumns} data={financingSales} />
    </div>
  );
}
