'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RoleDataTable } from '@/components/roles/role-data-table';
import { getRoleColumns } from '@/components/roles/role-columns';
import { RoleDialog } from '@/components/roles/role-dialog';
import { supabase } from '@/lib/supabase/client';
import { rowToRole } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import type { Role } from '@/lib/types';
import { PlusCircle } from 'lucide-react';

export default function RolesPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId || null;

  const [roles, setRoles] = useState<Role[]>([]);
  const [dialogRole, setDialogRole] = useState<Role | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('roles')
      .select('id, name, description, key, is_system, permissions')
      .order('is_system', { ascending: false })
      .order('name');
    if (data) setRoles(data.map(rowToRole));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('roles').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Rol eliminado', description: `"${deleteTarget.name}" fue eliminado.` });
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudo eliminar', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const columns = getRoleColumns({
    onEdit: (role) => { setDialogRole(role); setDialogOpen(true); },
    onDelete: (role) => setDeleteTarget(role),
  });

  return (
    <div>
      <PageHeader title="Roles y Permisos">
        <Button onClick={() => { setDialogRole(null); setDialogOpen(true); }}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Nuevo Rol
        </Button>
      </PageHeader>

      <RoleDataTable columns={columns} data={roles} />

      <RoleDialog
        role={dialogRole}
        companyId={activeCompanyId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={load}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el rol "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Los usuarios que tengan este rol asignado lo perderán. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
