'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { PlatformUsersTable } from '@/components/admin/platform-users-table';
import { PlatformUserDialog } from '@/components/admin/platform-user-dialog';
import type { Company } from '@/lib/types';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier' | 'manager';
  companyId: string | null;
  branchId: string | null;
  branchName: string;
  branches: { id: string; name: string; companyId: string }[];
  customRoles: { id: string; name: string; description: string }[];
  emailConfirmedAt: string | null;
}

export interface PlatformBranch {
  id: string;
  name: string;
  location: string | null;
  companyId: string;
}

export default function PlatformUsersPage() {
  const { appUser } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<PlatformBranch[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<PlatformUser | null>(null);

  const load = useCallback(async () => {
    const [{ data: comps }, { data: brs }, { data: profs }] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('branches').select('id, name, location, company_id').order('name'),
      // RLS: el super admin ve los perfiles de todos los tenants.
      supabase
        .from('profiles')
        .select(`
          id, name, email, role, is_super_admin, company_id, branch_id, email_confirmed_at,
          branches!profiles_branch_id_fkey(name),
          profile_roles(roles(id, name, description)),
          profile_branches(company_id, branches(id, name))
        `),
    ]);

    if (comps) setCompanies(comps as Company[]);
    if (brs) {
      setBranches(brs.map((b: any) => ({ id: b.id, name: b.name, location: b.location, companyId: b.company_id })));
    }
    if (profs) {
      setUsers(
        (profs as any[])
          .filter((p) => !p.is_super_admin) // los admins de plataforma no pertenecen a una empresa/sucursal
          .map((p) => ({
            id: p.id,
            name: p.name ?? 'Usuario',
            email: p.email ?? '',
            role: p.role,
            companyId: p.company_id,
            branchId: p.branch_id,
            branchName: Array.isArray(p.branches) ? p.branches[0]?.name ?? '' : p.branches?.name ?? '',
            branches: (p.profile_branches ?? [])
              .filter((pb: any) => pb.branches)
              .map((pb: any) => ({ id: pb.branches.id, name: pb.branches.name, companyId: pb.company_id })),
            customRoles: (p.profile_roles ?? [])
              .map((pr: any) => pr.roles)
              .filter(Boolean)
              .map((r: any) => ({ id: r.id, name: r.name, description: r.description ?? '' })),
            emailConfirmedAt: p.email_confirmed_at,
          }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (appUser?.isSuperAdmin) load(); }, [appUser, load]);

  if (!appUser?.isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Usuarios de la Plataforma" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No tienes permiso para ver esta sección.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usuarios de la Plataforma</h1>
        <p className="text-muted-foreground mt-1">
          Consulta y gestiona los usuarios de todas las empresas y sucursales.
        </p>
      </div>

      <PlatformUsersTable
        users={users}
        companies={companies}
        branches={branches}
        loading={loading}
        onEditUser={setEditingUser}
        onRefresh={load}
      />

      <PlatformUserDialog
        user={editingUser}
        companies={companies}
        branches={branches}
        open={editingUser !== null}
        onOpenChange={(o) => { if (!o) setEditingUser(null); }}
        onSaved={load}
      />
    </div>
  );
}
