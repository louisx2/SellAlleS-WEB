'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { roleToRow } from '@/lib/supabase/mappers';
import { PERMISSION_ACTIONS, PERMISSION_RESOURCES, RESOURCE_MODULE, REPORT_ITEMS } from '@/lib/permissions';
import type { ModuleKey } from '@/lib/modules';
import type { PermissionAction, PermissionResource, Role, RolePermissions } from '@/lib/types';

interface RoleDialogProps {
  role: Role | null;
  companyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
  // Módulos activados para la empresa que se está editando: un recurso solo
  // se muestra en la grilla si su módulo (RESOURCE_MODULE) está activado, o
  // si es un recurso núcleo (no aparece en el mapa).
  isModuleEnabled: (key: ModuleKey) => boolean;
}

const emptyPermissions: RolePermissions = {};

export function RoleDialog({ role, companyId, open, onOpenChange, onSaved, isModuleEnabled }: RoleDialogProps) {
  const { toast } = useToast();
  const { appUser } = useAuth();
  const isEditMode = !!role;
  const isSystem = !!role?.isSystem;
  // El nombre/clave de Administrador/Cajero son su identidad, siempre fijos.
  // Sus permisos ahora SÍ controlan acceso real, así que un super admin (y
  // solo un super admin) puede editarlos para cualquier empresa.
  const isSuperAdmin = !!appUser?.isSuperAdmin;
  const permissionsLocked = isSystem && !isSuperAdmin;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<RolePermissions>(emptyPermissions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setPermissions(role?.permissions ?? {});
  }, [open, role]);

  const visibleResources = useMemo(
    () => PERMISSION_RESOURCES.filter((r) => {
      const mod = RESOURCE_MODULE[r.key];
      return !mod || isModuleEnabled(mod);
    }),
    [isModuleEnabled]
  );
  const showReportsTab = visibleResources.some((r) => r.key === 'reports');

  const toggle = (resource: PermissionResource, action: PermissionAction, checked: boolean) => {
    setPermissions((prev) => {
      const current = new Set(prev[resource] ?? []);
      if (checked) current.add(action); else current.delete(action);
      return { ...prev, [resource]: Array.from(current) };
    });
  };

  // reports_visible ausente = todos visibles; al desmarcar el primero se
  // arranca desde "todos" y se le quita ese uno.
  const toggleReport = (slug: string, checked: boolean) => {
    setPermissions((prev) => {
      const current = new Set(prev.reports_visible ?? REPORT_ITEMS.map((r) => r.slug));
      if (checked) current.add(slug); else current.delete(slug);
      return { ...prev, reports_visible: Array.from(current) };
    });
  };
  const isReportChecked = (slug: string) => (permissions.reports_visible ?? REPORT_ITEMS.map((r) => r.slug)).includes(slug);

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
              ? (isSuperAdmin
                  ? 'Como super admin puedes editar los permisos de este rol de sistema. El nombre y la clave quedan fijos.'
                  : 'Los permisos de Administrador y Cajero son fijos y no se pueden modificar.')
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

          {showReportsTab ? (
            <Tabs defaultValue="permisos">
              <TabsList>
                <TabsTrigger value="permisos">Permisos</TabsTrigger>
                <TabsTrigger value="reportes">Reportes</TabsTrigger>
              </TabsList>
              <TabsContent value="permisos">
                <PermissionsGrid resources={visibleResources} permissions={permissions} isSystem={permissionsLocked} toggle={toggle} />
              </TabsContent>
              <TabsContent value="reportes">
                <div className="rounded-lg border p-3 grid gap-2">
                  <p className="text-xs text-muted-foreground">
                    Elige qué reportes puede ver este rol dentro de "Reportes".
                  </p>
                  {REPORT_ITEMS.map((item) => (
                    <label key={item.slug} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={isReportChecked(item.slug)}
                        disabled={permissionsLocked}
                        onCheckedChange={(c) => toggleReport(item.slug, !!c)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <PermissionsGrid resources={visibleResources} permissions={permissions} isSystem={permissionsLocked} toggle={toggle} />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cerrar</Button>
          {!permissionsLocked && (
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsGrid({
  resources, permissions, isSystem, toggle,
}: {
  resources: { key: PermissionResource; label: string }[];
  permissions: RolePermissions;
  isSystem: boolean;
  toggle: (resource: PermissionResource, action: PermissionAction, checked: boolean) => void;
}) {
  return (
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
          {resources.map((r) => (
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
  );
}
