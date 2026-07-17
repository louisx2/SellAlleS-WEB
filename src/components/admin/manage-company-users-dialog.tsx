'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { PlusCircle, Trash2, ShieldCheck, Shield, Link2, Unlink } from 'lucide-react';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier';
  isSuperAdmin: boolean;
  branchId: string | null;
  roleIds: string[];
}

interface RoleOption { id: string; name: string; }

interface BranchOption { id: string; name: string; }

// Usuario cuya empresa PRINCIPAL es otra, pero que tiene acceso a esta
// empresa vía profile_companies (multi-empresa).
interface LinkedUser {
  id: string;
  name: string;
  email: string;
  primaryCompanyName: string;
}

const NONE = 'none';
const emptyAddForm = { name: '', email: '', password: '', role: 'cashier' as 'admin' | 'cashier', branchId: '' };

interface ManageCompanyUsersDialogProps {
  companyId: string | null;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Gestión de usuarios de UNA empresa desde el panel de super admin, sin necesidad
// de impersonar: consulta y escribe directamente por companyId (el super admin
// ignora RLS). Permite agregar, mover de sucursal y eliminar.
export function ManageCompanyUsersDialog({ companyId, companyName, open, onOpenChange }: ManageCompanyUsersDialogProps) {
  const { toast } = useToast();
  const { appUser } = useAuth();

  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<CompanyUser | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);

  // Vincular un usuario EXISTENTE (de otra empresa) a esta empresa.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkedUsers, setLinkedUsers] = useState<LinkedUser[]>([]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [{ data: profs }, { data: bs }, { data: rls }, { data: links }] = await Promise.all([
      supabase.from('profiles').select('id, name, email, role, is_super_admin, branch_id, profile_roles(role_id)').eq('company_id', companyId).order('name'),
      supabase.from('branches').select('id, name').eq('company_id', companyId).order('name'),
      supabase.from('roles').select('id, name').eq('company_id', companyId).eq('is_system', false).order('name'),
      // Usuarios con acceso a esta empresa cuya empresa principal es OTRA.
      supabase.from('profile_companies').select('profiles(id, name, email, company_id, companies(name))').eq('company_id', companyId),
    ]);
    setUsers((profs ?? []).map((p: any) => ({
      id: p.id, name: p.name ?? 'Usuario', email: p.email ?? '',
      role: p.role, isSuperAdmin: p.is_super_admin === true, branchId: p.branch_id,
      roleIds: (p.profile_roles ?? []).map((pr: any) => pr.role_id),
    })));
    setBranches((bs ?? []).map((b: any) => ({ id: b.id, name: b.name })));
    setRoles((rls ?? []).map((r: any) => ({ id: r.id, name: r.name })));
    setLinkedUsers(
      (links ?? [])
        .map((l: any) => l.profiles)
        .filter((p: any) => p && p.company_id !== companyId)
        .map((p: any) => ({
          id: p.id,
          name: p.name ?? 'Usuario',
          email: p.email ?? '',
          primaryCompanyName: p.companies?.name ?? 'Otra empresa',
        }))
    );
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (open && companyId) { load(); setAddOpen(false); setAddForm(emptyAddForm); setLinkOpen(false); setLinkEmail(''); }
  }, [open, companyId, load]);

  const setBusy = (id: string, v: boolean) => setRowBusy((prev) => ({ ...prev, [id]: v }));

  const handleMoveBranch = async (user: CompanyUser, newBranchId: string) => {
    if (!companyId || newBranchId === user.branchId) return;
    setBusy(user.id, true);
    try {
      const { error } = await supabase.from('profiles').update({ branch_id: newBranchId }).eq('id', user.id);
      if (error) throw error;
      await supabase.from('profile_branches').delete().eq('profile_id', user.id);
      await supabase.from('profile_branches').insert({ profile_id: user.id, branch_id: newBranchId, company_id: companyId });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, branchId: newBranchId } : u)));
      toast({ title: 'Sucursal actualizada', description: `${user.name} movido de sucursal.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo mover al usuario.', variant: 'destructive' });
    } finally {
      setBusy(user.id, false);
    }
  };

  const handleRoleChange = async (user: CompanyUser, newRole: 'admin' | 'cashier') => {
    if (newRole === user.role) return;
    setBusy(user.id, true);
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', user.id);
      if (error) throw error;
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
      toast({ title: 'Rol actualizado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo cambiar el rol.', variant: 'destructive' });
    } finally {
      setBusy(user.id, false);
    }
  };

  const handleToggleRole = async (user: CompanyUser, roleId: string, checked: boolean) => {
    const nextRoleIds = checked ? [...user.roleIds, roleId] : user.roleIds.filter((id) => id !== roleId);
    setBusy(user.id, true);
    try {
      await supabase.from('profile_roles').delete().eq('profile_id', user.id);
      if (nextRoleIds.length > 0) {
        const { error } = await supabase.from('profile_roles').insert(nextRoleIds.map((roleId) => ({ profile_id: user.id, role_id: roleId })));
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, roleIds: nextRoleIds } : u)));
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo actualizar el rol.', variant: 'destructive' });
    } finally {
      setBusy(user.id, false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === appUser?.id) {
      toast({ title: 'No permitido', description: 'No puedes eliminar tu propio usuario.', variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    setBusy(deleteTarget.id, true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'delete', userId: deleteTarget.id },
      });
      if (error) throw new Error((data as any)?.error ?? error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      toast({ title: 'Usuario eliminado', description: deleteTarget.name });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo eliminar.', variant: 'destructive' });
    } finally {
      setBusy(deleteTarget.id, false);
      setDeleteTarget(null);
    }
  };

  const handleAdd = async () => {
    if (!companyId) return;
    if (!addForm.name.trim() || !addForm.email.trim() || !addForm.password.trim() || !addForm.branchId) {
      toast({ title: 'Faltan datos', description: 'Completa nombre, email, contraseña y sucursal.', variant: 'destructive' });
      return;
    }
    if (addForm.password.length < 6) {
      toast({ title: 'Contraseña débil', description: 'Debe tener al menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    setAddSaving(true);
    try {
      // Alta vía Edge Function (service_role): mismo camino que /users. Evita
      // el signUp público (rate-limit de correos) y confirma el correo de una
      // vez, ya que el super admin verificó la identidad al crearlo.
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: {
          action: 'create',
          companyId,
          name: addForm.name.trim(),
          email: addForm.email.trim(),
          password: addForm.password,
          role: addForm.role,
          branchId: addForm.branchId,
          branchIds: [addForm.branchId],
        },
      });
      if (error) throw new Error((data as any)?.error ?? error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({ title: 'Usuario creado', description: `${addForm.name} añadido a ${companyName}.` });
      setAddForm(emptyAddForm);
      setAddOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error al crear', description: err?.message ?? 'No se pudo crear el usuario.', variant: 'destructive' });
    } finally {
      setAddSaving(false);
    }
  };

  // Vincular por email un usuario que ya existe en otra empresa: inserta la
  // fila en profile_companies. El usuario verá "Mis Empresas" al entrar y
  // podrá cambiarse a esta empresa (sin tocar su empresa principal actual).
  const handleLink = async () => {
    if (!companyId) return;
    const email = linkEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: 'Escribe el correo', description: 'Indica el correo del usuario existente.', variant: 'destructive' });
      return;
    }
    setLinkSaving(true);
    try {
      const { data: prof, error: findErr } = await supabase
        .from('profiles')
        .select('id, name, email, company_id, is_super_admin')
        .ilike('email', email)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!prof) throw new Error('No existe ningún usuario con ese correo.');
      if (prof.is_super_admin) throw new Error('Un super admin ya tiene acceso a todas las empresas.');
      if (prof.company_id === companyId) throw new Error('Ese usuario ya pertenece a esta empresa.');

      const { error: linkErr } = await supabase
        .from('profile_companies')
        .upsert({ profile_id: prof.id, company_id: companyId }, { onConflict: 'profile_id,company_id' });
      if (linkErr) throw linkErr;

      toast({ title: 'Usuario vinculado', description: `${prof.name ?? prof.email} ahora puede entrar a ${companyName} desde "Mis Empresas".` });
      setLinkEmail('');
      setLinkOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudo vincular', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setLinkSaving(false);
    }
  };

  const handleUnlink = async (lu: LinkedUser) => {
    if (!companyId) return;
    setBusy(lu.id, true);
    try {
      const { error } = await supabase
        .from('profile_companies')
        .delete()
        .eq('profile_id', lu.id)
        .eq('company_id', companyId);
      if (error) throw error;
      setLinkedUsers((prev) => prev.filter((u) => u.id !== lu.id));
      toast({ title: 'Acceso retirado', description: `${lu.name} ya no puede entrar a ${companyName}.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo desvincular.', variant: 'destructive' });
    } finally {
      setBusy(lu.id, false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Usuarios de {companyName}</DialogTitle>
            <DialogDescription>Agrega, mueve entre sucursales o elimina usuarios de esta empresa.</DialogDescription>
          </DialogHeader>

          {!addOpen && !linkOpen && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Agregar usuario
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                <Link2 className="mr-2 h-4 w-4" /> Vincular usuario existente
              </Button>
            </div>
          )}

          {linkOpen && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="linkEmail">Correo del usuario existente</Label>
                <Input
                  id="linkEmail"
                  type="email"
                  placeholder="usuario@correo.com"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                  disabled={linkSaving}
                />
                <p className="text-xs text-muted-foreground">
                  El usuario debe existir en otra empresa. Quedará vinculado a {companyName} y al iniciar sesión verá "Mis Empresas" para elegir a cuál entrar.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setLinkOpen(false); setLinkEmail(''); }} disabled={linkSaving}>Cancelar</Button>
                <Button size="sm" onClick={handleLink} disabled={linkSaving}>
                  {linkSaving ? 'Vinculando…' : 'Vincular'}
                </Button>
              </div>
            </div>
          )}

          {addOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="addName">Nombre</Label>
                <Input id="addName" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="addEmail">Email</Label>
                <Input id="addEmail" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="addPassword">Contraseña</Label>
                <Input id="addPassword" type="password" placeholder="Mínimo 6 caracteres" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Rol</Label>
                <Select value={addForm.role} onValueChange={(v) => setAddForm({ ...addForm, role: v as 'admin' | 'cashier' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="cashier">Cajero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Sucursal</Label>
                <Select value={addForm.branchId} onValueChange={(v) => setAddForm({ ...addForm, branchId: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona una sucursal" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setAddOpen(false); setAddForm(emptyAddForm); }} disabled={addSaving}>Cancelar</Button>
                <Button size="sm" onClick={handleAdd} disabled={addSaving || branches.length === 0}>
                  {addSaving ? 'Creando…' : 'Crear usuario'}
                </Button>
              </div>
              {branches.length === 0 && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">Esta empresa no tiene sucursales todavía. Crea una primero.</p>
              )}
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Roles adicionales</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
                ) : users.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin usuarios todavía.</TableCell></TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        {u.isSuperAdmin ? (
                          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Super Admin</Badge>
                        ) : (
                          <Select value={u.role} onValueChange={(v) => handleRoleChange(u, v as 'admin' | 'cashier')} disabled={rowBusy[u.id]}>
                            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Administrador</SelectItem>
                              <SelectItem value="cashier">Cajero</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select value={u.branchId ?? NONE} onValueChange={(v) => handleMoveBranch(u, v)} disabled={rowBusy[u.id]}>
                          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Sin sucursal" /></SelectTrigger>
                          <SelectContent>
                            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {u.isSuperAdmin ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-8 text-xs" disabled={rowBusy[u.id]}>
                                <Shield className="mr-1.5 h-3.5 w-3.5" />
                                {u.roleIds.length > 0 ? `${u.roleIds.length} rol(es)` : 'Sin roles'}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56" align="start">
                              {roles.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  Esta empresa no tiene roles personalizados. Créalos desde "Gestionar roles".
                                </p>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  {roles.map((r) => (
                                    <div key={r.id} className="flex items-center space-x-2">
                                      <Checkbox
                                        id={`mcu-role-${u.id}-${r.id}`}
                                        checked={u.roleIds.includes(r.id)}
                                        onCheckedChange={(c) => handleToggleRole(u, r.id, !!c)}
                                      />
                                      <Label htmlFor={`mcu-role-${u.id}-${r.id}`} className="font-normal cursor-pointer text-sm">
                                        {r.name}
                                      </Label>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                          disabled={rowBusy[u.id] || u.id === appUser?.id}
                          title="Eliminar usuario"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {linkedUsers.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Usuarios de otras empresas con acceso</p>
              <p className="text-xs text-muted-foreground">
                Su empresa principal es otra, pero pueden entrar a {companyName} desde "Mis Empresas".
              </p>
              <div className="space-y-2">
                {linkedUsers.map((lu) => (
                  <div key={lu.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{lu.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{lu.email} · Principal: {lu.primaryCompanyName}</div>
                    </div>
                    <Button
                      variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive shrink-0"
                      onClick={() => handleUnlink(lu)}
                      disabled={rowBusy[lu.id]}
                    >
                      <Unlink className="mr-1.5 h-3.5 w-3.5" /> Quitar acceso
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará su cuenta por completo (perfil y acceso). Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
