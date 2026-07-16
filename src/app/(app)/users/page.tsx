'use client';

import { PageHeader } from '@/components/page-header';
import { UserDataTable } from '@/components/users/user-data-table';
import { userColumns } from '@/components/users/user-columns';
import { UserDialog } from '@/components/users/user-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, AlertCircle } from 'lucide-react';
import { useUsers } from '@/context/user-provider';
import { useAuth } from '@/context/auth-provider';

export default function UsersPage() {
  const { users } = useUsers();
  const { appUser } = useAuth();

  const maxUsers = appUser?.companyMaxUsers ?? null;
  const currentUsersCount = users.filter(u => !u.isSuperAdmin).length;
  const isLimitReached = maxUsers !== null && currentUsersCount >= maxUsers;

  return (
    <div>
      <PageHeader title="Usuarios">
        {isLimitReached ? (
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
            <span className="text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Límite alcanzado ({currentUsersCount} de {maxUsers} usuarios)
            </span>
            <Button disabled className="cursor-not-allowed">
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir Usuario
            </Button>
          </div>
        ) : (
          <UserDialog>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir Usuario
            </Button>
          </UserDialog>
        )}
      </PageHeader>
      <UserDataTable columns={userColumns} data={users} />
    </div>
  );
}
