'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import type { Role } from '@/lib/types';
import { resolveEnabledModules, type ModuleKey } from '@/lib/modules';
import { PlusCircle } from 'lucide-react';

interface CompanyRolesDialogProps {
  companyId: string | null;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Igual que /roles/page.tsx, pero para que el super admin gestione los
// roles de CUALQUIER empresa directamente, sin necesidad de impersonarla
// (RLS de `roles` ya permite esto vía is_super_admin()).
export function CompanyRolesDialog({ companyId, companyName, open, onOpenChange }: CompanyRolesDialogProps) {
  const { toast } = useToast();
  const { appUser } = useAuth();

  const [roles, setRoles] = useState<Role[]>([]);
  const [enabledModules, setEnabledModules] = useState<Set<ModuleKey>>(() => resolveEnabledModules([]));
  const [dialogRole, setDialogRole] = useState<Role | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('roles')
      .select('id, name, description, key, is_system, permissions')
      .eq('company_id', companyId)
      .order('is_system', { ascending: false })
      .order('name');
    if (data) setRoles(data.map(rowToRole));
  }, [companyId]);

  // useModules() está atado a la empresa del super admin, no a la empresa
  // que se está gestionando aquí sin impersonar — se resuelve aparte.
  const loadModules = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('company_modules')
      .select('module_key, enabled')
      .eq('company_id', companyId);
    setEnabledModules(resolveEnabledModules(data ?? []));
  }, [companyId]);

  useEffect(() => {
    if (open && companyId) { load(); loadModules(); }
  }, [open, companyId, load, loadModules]);

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
    onEdit: (role) => { setDialogRole(role); setRoleDialogOpen(true); },
    onDelete: (role) => setDeleteTarget(role),
    isSuperAdmin: appUser?.isSuperAdmin,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Roles de {companyName}</DialogTitle>
            <DialogDescription>
              Crea, edita o elimina roles personalizados para esta empresa (ej. "Técnico"), sin necesidad de entrar a ella.
            </DialogDescription>
          </DialogHeader>

          <Button variant="outline" size="sm" className="w-fit" onClick={() => { setDialogRole(null); setRoleDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Nuevo Rol
          </Button>

          <RoleDataTable columns={columns} data={roles} />
        </DialogContent>
      </Dialog>

      <RoleDialog
        role={dialogRole}
        companyId={companyId}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        onSaved={load}
        isModuleEnabled={(key) => enabledModules.has(key)}
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
    </>
  );
}
