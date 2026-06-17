'use client';

import { PageHeader } from '@/components/page-header';
import { UserDataTable } from '@/components/users/user-data-table';
import { userColumns } from '@/components/users/user-columns';
import { UserDialog } from '@/components/users/user-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useUsers } from '@/context/user-provider';

export default function UsersPage() {
  const { users } = useUsers();

  return (
    <div>
      <PageHeader title="Usuarios">
        <UserDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Añadir Usuario
          </Button>
        </UserDialog>
      </PageHeader>
      <UserDataTable columns={userColumns} data={users} />
    </div>
  );
}
