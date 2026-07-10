'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { LoanDataTable } from '@/components/loans/loan-data-table';
import { buildLoanColumns } from '@/components/loans/loan-columns';
import { LoanDialog } from '@/components/loans/loan-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';

export default function PrestamosPage() {
  const { loans } = useLoans();
  const { profile } = useCompanyProfile();
  const columns = useMemo(() => buildLoanColumns(profile.loanLateFeeRate), [profile.loanLateFeeRate]);

  return (
    <div>
      <PageHeader title="Préstamos">
        <LoanDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Nuevo préstamo
          </Button>
        </LoanDialog>
      </PageHeader>
      <LoanDataTable columns={columns} data={loans} />
    </div>
  );
}
