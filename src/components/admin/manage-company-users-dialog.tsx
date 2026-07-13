'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { PlusCircle, Trash2, ShieldCheck } from 'lucide-react';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier';
  isSuperAdmin: boolean;
  branchId: string | null;
}

interface BranchOption { id: string; name: string; }

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
  const [loading, setLoading] = useState(true);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<CompanyUser | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [{ data: profs }, { data: bs }] = await Promise.all([
      supabase.from('profiles').select('id, name, email, role, is_super_admin, branch_id').eq('company_id', companyId).order('name'),
      supabase.from('branches').select('id, name').eq('company_id', companyId).order('name'),
    ]);
    setUsers((profs ?? []).map((p: any) => ({
      id: p.id, name: p.name ?? 'Usuario', email: p.email ?? '',
      role: p.role, isSuperAdmin: p.is_super_admin === true, branchId: p.branch_id,
    })));
    setBranches((bs ?? []).map((b: any) => ({ id: b.id, name: b.name })));
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (open && companyId) { load(); setAddOpen(false); setAddForm(emptyAddForm); }
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
      // Cliente temporal (sin persistir sesión) para no pisar la sesión del super
      // admin: auth.signUp es una operación pública, no requiere service_role.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const tempClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

      const { data: authData, error: authError } = await tempClient.auth.signUp({
        email: addForm.email.trim(),
        password: addForm.password,
        options: { data: { name: addForm.name.trim() } },
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear la cuenta.');

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: authData.user.id,
        email: addForm.email.trim(),
        name: addForm.name.trim(),
        role: addForm.role,
        company_id: companyId,
        branch_id: addForm.branchId,
      });
      if (profileError) throw profileError;

      await supabase.from('profile_branches').insert({
        profile_id: authData.user.id, branch_id: addForm.branchId, company_id: companyId,
      });

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Usuarios de {companyName}</DialogTitle>
            <DialogDescription>Agrega, mueve entre sucursales o elimina usuarios de esta empresa.</DialogDescription>
          </DialogHeader>

          {!addOpen ? (
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setAddOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Agregar usuario
            </Button>
          ) : (
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
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
                ) : users.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sin usuarios todavía.</TableCell></TableRow>
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
