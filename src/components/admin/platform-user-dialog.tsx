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
import { BranchChecklist } from '@/components/users/branch-checklist';
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
  const [role, setRole] = useState<'admin' | 'cashier' | 'manager'>('cashier');
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [resending, setResending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    const isManager = user.customRoles?.some(r => r.name.toLowerCase().includes('gerente'));
    const managerRoleIds = user.customRoles?.filter(r => r.name.toLowerCase().includes('gerente')).map(r => r.id) ?? [];
    
    setRole(user.role === 'admin' ? 'admin' : (isManager ? 'manager' : 'cashier'));
    setSelectedRoleIds(user.customRoles.map((r) => r.id).filter(id => !managerRoleIds.includes(id)));
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

  }, [open, user]);

  // Las sucursales disponibles reaccionan a la empresa principal actualmente
  // seleccionada (la primera marcada en el multi-empresa), no a la empresa
  // original del perfil: si el super admin cambia la empresa principal, las
  // sucursales del checklist deben ser las de esa empresa.
  const effectivePrimaryCompanyId = selectedCompanyIds.length > 0 ? selectedCompanyIds[0] : (user?.companyId ?? null);
  const companyBranches = branches.filter((b) => b.companyId === effectivePrimaryCompanyId);

  // Los roles personalizados disponibles también reaccionan a la empresa
  // principal seleccionada (no a la empresa original del perfil), y excluyen
  // los roles de sistema (Administrador/Cajero: esos ya los representa el
  // selector "Rol" de arriba, no tiene sentido marcarlos como "adicionales").
  useEffect(() => {
    if (!open || !effectivePrimaryCompanyId) { setAvailableRoles([]); return; }
    supabase
      .from('roles')
      .select('id, name, description')
      .eq('company_id', effectivePrimaryCompanyId)
      .eq('is_system', false)
      .order('name')
      .then(({ data }) => {
        if (data) setAvailableRoles(data.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '' })));
      });
  }, [open, effectivePrimaryCompanyId]);

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
    if (selectedBranchIds.length === 0) {
      toast({ title: 'Selecciona al menos una sucursal', description: 'El usuario necesita acceso a al menos una sucursal.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const primaryCompanyId = selectedCompanyIds.length > 0 ? selectedCompanyIds[0] : null;
      // Sucursal activa: mantiene la que ya tenía si sigue marcada, si no la primera marcada.
      const activeBranchId = selectedBranchIds.includes(user.branchId ?? '') ? user.branchId : selectedBranchIds[0];
      const finalBranchIds = selectedBranchIds;

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

      const isManagerRole = role === 'manager';
      const dbRole = isManagerRole ? 'cashier' : role;

      const { error } = await supabase
        .from('profiles')
        .update({
          role: dbRole,
          branch_id: activeBranchId || null,
          company_id: primaryCompanyId
        })
        .eq('id', user.id);
      if (error) throw error;

      const finalRoleIds = [...selectedRoleIds];
      if (isManagerRole && primaryCompanyId) {
        const { data: gerenteRole } = await supabase
          .from('roles')
          .select('id')
          .eq('company_id', primaryCompanyId)
          .ilike('name', '%gerente%')
          .maybeSingle();

        if (gerenteRole && !finalRoleIds.includes(gerenteRole.id)) {
          finalRoleIds.push(gerenteRole.id);
        }
      }

      await supabase.from('profile_roles').delete().eq('profile_id', user.id);
      if (finalRoleIds.length > 0) {
        await supabase
          .from('profile_roles')
          .insert(finalRoleIds.map((roleId) => ({ profile_id: user.id, role_id: roleId })));
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

          <div className="grid gap-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'cashier' | 'manager')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="manager">Gerente</SelectItem>
                <SelectItem value="cashier">Cajero</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Sucursales</Label>
            <BranchChecklist
              branches={companyBranches}
              selectedIds={selectedBranchIds}
              onChange={setSelectedBranchIds}
              idPrefix="platform-branch"
            />
          </div>

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

          {availableRoles.filter(r => !r.name.toLowerCase().includes('gerente')).length > 0 && (
            <div className="grid gap-2 pt-1">
              <Label>Roles adicionales</Label>
              <div className="flex flex-col gap-2">
                {availableRoles.filter(r => !r.name.toLowerCase().includes('gerente')).map((r) => (
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
