'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { roleToRow } from '@/lib/supabase/mappers';
import { PERMISSION_ACTIONS, PERMISSION_RESOURCES } from '@/lib/permissions';
import type { PermissionAction, PermissionResource, Role } from '@/lib/types';

interface RoleDialogProps {
  role: Role | null;
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

const emptyPermissions: Partial<Record<PermissionResource, PermissionAction[]>> = {};

export function RoleDialog({ role, companyId, open, onOpenChange, onSaved }: RoleDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!role;
  const isSystem = !!role?.isSystem;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<Partial<Record<PermissionResource, PermissionAction[]>>>(emptyPermissions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setPermissions(role?.permissions ?? {});
  }, [open, role]);

  const toggle = (resource: PermissionResource, action: PermissionAction, checked: boolean) => {
    setPermissions((prev) => {
      const current = new Set(prev[resource] ?? []);
      if (checked) current.add(action); else current.delete(action);
      return { ...prev, [resource]: Array.from(current) };
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Falta el nombre', description: 'Ponle un nombre al rol.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (isEditMode && role) {
        const { error } = await supabase.from('roles').update(roleToRow({ name: name.trim(), description, permissions })).eq('id', role.id);
        if (error) throw error;
        toast({ title: 'Rol actualizado' });
      } else {
        if (!companyId) throw new Error('No hay una empresa activa.');
        const { error } = await supabase.from('roles').insert({ ...roleToRow({ name: name.trim(), description, permissions }), company_id: companyId });
        if (error) throw error;
        toast({ title: 'Rol creado' });
      }
      onOpenChange(false);
      await onSaved();
    } catch (err: any) {
      toast({ title: 'No se pudo guardar', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditMode ? 'Editar rol' : 'Nuevo rol'}
            {isSystem && <Badge variant="outline">Rol de sistema</Badge>}
          </DialogTitle>
          <DialogDescription>
            {isSystem
              ? 'Los permisos de Administrador y Cajero son fijos y no se pueden modificar.'
              : 'Define a qué secciones tiene acceso este rol y qué puede hacer en cada una.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="role-name">Nombre</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSystem} placeholder="Ej: Gerente de Inventario" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-desc">Descripción</Label>
              <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={isSystem} />
            </div>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-2 font-medium">Sección</th>
                  {PERMISSION_ACTIONS.map((a) => (
                    <th key={a.key} className="text-center p-2 font-medium whitespace-nowrap">{a.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_RESOURCES.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="p-2">{r.label}</td>
                    {PERMISSION_ACTIONS.map((a) => (
                      <td key={a.key} className="text-center p-2">
                        <Checkbox
                          checked={!!permissions[r.key]?.includes(a.key)}
                          disabled={isSystem}
                          onCheckedChange={(c) => toggle(r.key, a.key, !!c)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cerrar</Button>
          {!isSystem && (
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
