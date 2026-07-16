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
import { Mail } from 'lucide-react';
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
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [allBranchesChecked, setAllBranchesChecked] = useState(false);
  const [resending, setResending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setRole(user.role);
    setBranchId(user.branchId ?? '');
    setSelectedRoleIds(user.customRoles.map((r) => r.id));
    setSelectedBranchIds(user.branches.map((b) => b.id));

    // Cargar las compañías asignadas al perfil
    supabase
      .from('profile_companies')
      .select('company_id')
      .eq('profile_id', user.id)
      .then(({ data }) => {
        if (data) {
          setSelectedCompanyIds(data.map((pc: any) => pc.company_id));
        } else {
          setSelectedCompanyIds([]);
        }
      });

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

  // La sucursal "todas" reacciona a la empresa principal actualmente seleccionada
  // (la primera marcada en el multi-empresa), no a la empresa original del perfil:
  // si el super admin cambia la empresa principal, las sucursales disponibles deben
  // ser las de esa empresa.
  const effectivePrimaryCompanyId = selectedCompanyIds.length > 0 ? selectedCompanyIds[0] : (user?.companyId ?? null);
  const companyBranches = branches.filter((b) => b.companyId === effectivePrimaryCompanyId);

  useEffect(() => {
    if (open && companyBranches.length > 0) {
      const others = companyBranches.filter((b) => b.id !== branchId);
      const isAll = others.length > 0 && others.every((b) => selectedBranchIds.includes(b.id));
      setAllBranchesChecked(isAll);
    }
  }, [open, branchId, selectedBranchIds, effectivePrimaryCompanyId, branches]);

  const handleAllBranchesToggle = (checked: boolean) => {
    setAllBranchesChecked(checked);
    if (checked) {
      setSelectedBranchIds(companyBranches.filter((b) => b.id !== branchId).map((b) => b.id));
    } else {
      setSelectedBranchIds([]);
    }
  };

  const handleResendConfirm = async () => {
    if (!user) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      toast({ title: 'Correo de confirmación enviado', description: `Se reenvió el enlace a ${user.email}.` });
    } catch (err: any) {
      toast({ title: 'Error al enviar', description: err?.message ?? 'No se pudo reenviar el correo.', variant: 'destructive' });
    } finally {
      setResending(false);
    }
  };

  if (!user) return null;

  const company = companies.find((c) => c.id === user.companyId);

  const handleSave = async () => {
    setSaving(true);
    try {
      const primaryCompanyId = selectedCompanyIds.length > 0 ? selectedCompanyIds[0] : null;
      const finalBranchIds = allBranchesChecked
        ? companyBranches.map((b) => b.id)
        : Array.from(new Set([branchId, ...selectedBranchIds].filter(Boolean)));

      // Insertar primero las asociaciones nuevas en profile_companies: el trigger
      // check_profile_company_access exige que la fila ya exista ahí antes de
      // aceptar el cambio de profiles.company_id a esa empresa.
      if (selectedCompanyIds.length > 0) {
        const { error: pcError } = await supabase
          .from('profile_companies')
          .upsert(
            selectedCompanyIds.map((compId) => ({ profile_id: user.id, company_id: compId })),
            { onConflict: 'profile_id,company_id' }
          );
        if (pcError) throw pcError;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          role,
          branch_id: branchId || null,
          company_id: primaryCompanyId
        })
        .eq('id', user.id);
      if (error) throw error;

      await supabase.from('profile_roles').delete().eq('profile_id', user.id);
      if (selectedRoleIds.length > 0) {
        await supabase
          .from('profile_roles')
          .insert(selectedRoleIds.map((roleId) => ({ profile_id: user.id, role_id: roleId })));
      }

      // Quitar asociaciones de empresas que quedaron desmarcadas (ya con
      // profiles.company_id apuntando a una de las que sí quedan, si aplica).
      if (selectedCompanyIds.length > 0) {
        await supabase
          .from('profile_companies')
          .delete()
          .eq('profile_id', user.id)
          .not('company_id', 'in', `(${selectedCompanyIds.join(',')})`);
      } else {
        await supabase.from('profile_companies').delete().eq('profile_id', user.id);
      }

      await supabase.from('profile_branches').delete().eq('profile_id', user.id);
      if (primaryCompanyId && finalBranchIds.length > 0) {
        await supabase.from('profile_branches').insert(
          finalBranchIds.map((bId) => ({ profile_id: user.id, branch_id: bId, company_id: primaryCompanyId }))
        );
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
            <Label>Empresas Asignadas (Multi-Empresa)</Label>
            <div className="border rounded-md p-3 max-h-[160px] overflow-y-auto space-y-2">
              {companies.map((c) => (
                <div key={c.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`company-checkbox-${c.id}`}
                    checked={selectedCompanyIds.includes(c.id)}
                    onCheckedChange={(checked) => {
                      setSelectedCompanyIds((prev) =>
                        checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                      );
                    }}
                  />
                  <Label htmlFor={`company-checkbox-${c.id}`} className="font-normal cursor-pointer text-sm">
                    {c.name}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              El usuario podrá gestionar todas las empresas seleccionadas. La primera seleccionada será su empresa principal por defecto.
            </p>
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

          {companyBranches.length > 1 && (
            <div className="grid gap-2">
              <Label>Sucursales adicionales</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="platform-all-branches"
                  checked={allBranchesChecked}
                  onCheckedChange={handleAllBranchesToggle}
                />
                <Label htmlFor="platform-all-branches" className="font-semibold cursor-pointer">
                  Administrador de todas las sucursales
                </Label>
              </div>
              <div className="pl-6 flex flex-col gap-2 border-l border-border">
                {companyBranches.filter((b) => b.id !== branchId).map((b) => (
                  <div key={b.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`platform-branch-${b.id}`}
                      checked={selectedBranchIds.includes(b.id) || allBranchesChecked}
                      disabled={allBranchesChecked}
                      onCheckedChange={(checked) => {
                        setSelectedBranchIds((prev) =>
                          checked ? [...prev, b.id] : prev.filter((id) => id !== b.id)
                        );
                      }}
                    />
                    <Label htmlFor={`platform-branch-${b.id}`} className="font-normal cursor-pointer">{b.name}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label>Verificación de correo</Label>
              <p className="text-xs text-muted-foreground">
                {user.emailConfirmedAt ? `Verificado el ${new Date(user.emailConfirmedAt).toLocaleDateString('es-DO')}.` : 'Este usuario todavía no confirmó su correo.'}
              </p>
            </div>
            {user.emailConfirmedAt ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Verificado</Badge>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={handleResendConfirm} disabled={resending}>
                <Mail className="mr-2 h-3.5 w-3.5" />
                {resending ? 'Enviando…' : 'Reenviar confirmación'}
              </Button>
            )}
          </div>

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
