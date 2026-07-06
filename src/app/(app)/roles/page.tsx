'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { RoleDataTable } from '@/components/roles/role-data-table';
import { roleColumns } from '@/components/roles/role-columns';
import { supabase } from '@/lib/supabase/client';
import type { Role } from '@/lib/types';

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    supabase
      .from('roles')
      .select('id, name, description')
      .order('name')
      .then(({ data }) => {
        if (data) setRoles(data.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '' })));
      });
  }, []);

  return (
    <div>
      <PageHeader title="Roles y Permisos" />
      <RoleDataTable columns={roleColumns} data={roles} />
    </div>
  );
}
