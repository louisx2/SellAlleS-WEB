'use client';

import { PageHeader } from '@/components/page-header';
import { roles } from '@/lib/database';
import { RoleDataTable } from '@/components/roles/role-data-table';
import { roleColumns } from '@/components/roles/role-columns';

export default function RolesPage() {
  return (
    <div>
      <PageHeader title="Roles y Permisos" />
      <RoleDataTable columns={roleColumns} data={roles} />
    </div>
  );
}
