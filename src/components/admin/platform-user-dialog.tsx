'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Company, Role } from '@/lib/types';
import type { PlatformBranch, PlatformUser } from '@/app/(app)/admin/users/page';

interface PlatformUserDialogProps {
  user: PlatformUser | null;
  companies: Company[];
  branches: PlatformBranch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}

export function PlatformUserDialog({ user, companies, branches, open, onOpenChange, onSaved }: PlatformUserDialogProps) {
  const { toast } = useToast();
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier');
  const [branchId, setBranchId] = useState<string>('');
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setRole(user.role);
    setBranchId(user.branchId ?? '');
    setSelectedRoleIds(user.customRoles.map((r) => r.id));

    if (user.companyId) {
      supabase
        .from('roles')
        .select('id, name, description')
        .eq('company_id', user.companyId)
        .order('name')
        .then(({ data }) => {
          if (data) setAvailableRoles(data.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '' })));
        });
    } else {
      setAvailableRoles([]);
    }
  }, [open, user]);

  if (!user) return null;

  const company = companies.find((c) => c.id === user.companyId);
  const companyBranches = branches.filter((b) => b.companyId === user.companyId);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role, branch_id: branchId || null })
        .eq('id', user.id);
      if (error) throw error;

      await supabase.from('profile_roles').delete().eq('profile_id', user.id);
      if (selectedRoleIds.length > 0) {
        await supabase
          .from('profile_roles')
          .insert(selectedRoleIds.map((roleId) => ({ profile_id: user.id, role_id: roleId })));
      }

      toast({ title: 'Usuario actualizado', description: `${user.name} se actualizó correctamente.` });
      onOpenChange(false);
      await onSaved();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo guardar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const branchChanged = branchId !== (user.branchId ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Usuario</DialogTitle>
          <DialogDescription>
            Gestiona el rol y la sucursal de <strong>{user.name}</strong> ({user.email}).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Empresa</Label>
            <div className="flex items-center h-10 px-3 rounded-md border bg-muted/40 text-sm">
              {company?.name ?? '—'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'cashier')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="cashier">Cajero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Sucursal</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="Selecciona una sucursal" /></SelectTrigger>
                <SelectContent>
                  {companyBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                  {companyBranches.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">Esta empresa no tiene sucursales.</p>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {branchChanged && (
            <p className="text-xs text-amber-600 -mt-2">
              Se transferirá a este usuario a la sucursal seleccionada al guardar.
            </p>
          )}

          {availableRoles.length > 0 && (
            <div className="grid gap-2 pt-1">
              <Label>Roles adicionales</Label>
              <div className="flex flex-col gap-2">
                {availableRoles.map((r) => (
                  <div key={r.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`platform-role-${r.id}`}
                      checked={selectedRoleIds.includes(r.id)}
                      onCheckedChange={(checked) => {
                        setSelectedRoleIds((prev) =>
                          checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                        );
                      }}
                    />
                    <Label htmlFor={`platform-role-${r.id}`} className="font-normal cursor-pointer">
                      {r.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {user.customRoles.length > 0 && availableRoles.length === 0 && (
            <div className="flex flex-wrap gap-1">
              {user.customRoles.map((r) => <Badge key={r.id} variant="outline">{r.name}</Badge>)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
