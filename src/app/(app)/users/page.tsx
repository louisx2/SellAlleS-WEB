'use client';

import { PageHeader } from '@/components/page-header';
import { UserDataTable } from '@/components/users/user-data-table';
import { userColumns } from '@/components/users/user-columns';
import { UserDialog } from '@/components/users/user-dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, AlertCircle } from 'lucide-react';
import { useUsers } from '@/context/user-provider';
import { useAuth } from '@/context/auth-provider';
import { usePermission } from '@/hooks/use-permission';

export default function UsersPage() {
  const { users } = useUsers();
  const { appUser } = useAuth();
  const canCreate = usePermission('users', 'create');

  // La lista que se ve arriba son los usuarios de la SUCURSAL activa (user-provider
  // filtra por ella), así que el aviso tiene que compararlos contra el cupo de esa
  // sucursal. Antes se comparaban contra el cupo de la EMPRESA, y encima contra el
  // de la empresa del propio perfil: un super admin dentro de otra empresa veía
  // "2 de 2" mezclando los usuarios de una sucursal con el cupo de su empresa demo.
  const enEstaSucursal = users.filter(u => !u.isSuperAdmin).length;
  const cupoSucursal = appUser?.branchMaxUsers ?? null;
  const cupoEmpresa = appUser?.companyMaxUsers ?? null;

  const sucursalLlena = cupoSucursal !== null && enEstaSucursal >= cupoSucursal;
  // El cupo de la empresa no se puede evaluar aquí con esta lista, porque solo trae
  // una sucursal. Lo frena la base al crear (check_company_membership_limit) y el
  // mensaje llega al diálogo.
  const isLimitReached = sucursalLlena;

  return (
    <div>
      <PageHeader title="Usuarios">
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          {/* Se dice de qué sucursal es el conteo, para que no se confunda con el
              total de la empresa. */}
          {cupoSucursal !== null && (
            <span
              className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 border ${
                sucursalLlena
                  ? 'text-destructive bg-destructive/10 border-destructive/20'
                  : 'text-muted-foreground bg-muted/50 border-border'
              }`}
            >
              {sucursalLlena && <AlertCircle className="h-3.5 w-3.5" />}
              {appUser?.branch ? `${appUser.branch}: ` : 'Esta sucursal: '}
              {enEstaSucursal} de {cupoSucursal} usuarios
            </span>
          )}
          {cupoEmpresa !== null && (
            <span className="text-xs text-muted-foreground">
              Cupo de la empresa: {cupoEmpresa}
            </span>
          )}
          {!canCreate ? null : isLimitReached ? (
            <Button disabled className="cursor-not-allowed">
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir Usuario
            </Button>
          ) : (
            <UserDialog>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Añadir Usuario
              </Button>
            </UserDialog>
          )}
        </div>
      </PageHeader>
      <UserDataTable columns={userColumns} data={users} />
    </div>
  );
}
