'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { FinancingDataTable } from '@/components/financing/financing-data-table';
import { buildFinancingColumns } from '@/components/financing/financing-columns';
import { PlusCircle } from 'lucide-react';

export default function FinancingPage() {
  const { sales } = useSales();
  const { profile } = useCompanyProfile();
  const financingSales = sales.filter(
    (sale) => sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing'
  );
  const columns = useMemo(() => buildFinancingColumns(profile.lateFeeRate), [profile.lateFeeRate]);

  return (
    <div>
      <PageHeader title="Gestión de Financiamientos">
        {/* Los financiamientos se generan en el POS (método de pago "Financiar"). */}
        <Button asChild>
          <Link href="/pos">
            <PlusCircle className="mr-2 h-4 w-4" />
            Nuevo financiamiento
          </Link>
        </Button>
      </PageHeader>
      <FinancingDataTable columns={columns} data={financingSales} />
    </div>
  );
}
