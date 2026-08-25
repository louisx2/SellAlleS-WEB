'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { FinancingDataTable } from '@/components/financing/financing-data-table';
import { buildFinancingColumns } from '@/components/financing/financing-columns';
import { PlusCircle, TrendingUp } from 'lucide-react';

export default function FinancingPage() {
  // El provider ya aplica el pool de 'financiamiento': lo propio siempre, más
  // lo de las sucursales con las que se comparta.
  const { financingSales } = useSales();
  const { profile } = useCompanyProfile();
  const columns = useMemo(() => buildFinancingColumns(profile.lateFeeRate), [profile.lateFeeRate]);

  return (
    <div>
      <PageHeader title="Gestión de Financiamientos">
        <Button asChild variant="outline">
          <Link href="/reports/financiamientos">
            <TrendingUp className="mr-2 h-4 w-4" />
            Ganancias
          </Link>
        </Button>
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
