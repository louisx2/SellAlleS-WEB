'use client';

import { PageHeader } from '@/components/page-header';
import { useBranches } from '@/context/branch-provider';
import { BranchDataTable } from '@/components/branches/branch-data-table';
import { branchColumns } from '@/components/branches/branch-columns';
import { BranchDialog } from '@/components/branches/branch-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useAuth } from '@/context/auth-provider';

export default function BranchesPage() {
  const { branches } = useBranches();
  const { appUser } = useAuth();

  return (
    <div>
      <PageHeader title="Sucursales">
        {appUser?.isSuperAdmin && (
          <BranchDialog>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir Sucursal
            </Button>
          </BranchDialog>
        )}
      </PageHeader>
      <BranchDataTable columns={branchColumns} data={branches} />
    </div>
  );
}
