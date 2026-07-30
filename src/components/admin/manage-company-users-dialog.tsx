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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlusCircle, Trash2, ShieldCheck, Shield, Link2, Unlink, MoreHorizontal, Mail } from 'lucide-react';
import { BranchChecklist } from '@/components/users/branch-checklist';
import { PasswordInput } from '@/components/ui/password-input';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'cashier';
  isSuperAdmin: boolean;
  // branchId es la sucursal por defecto (donde aterriza al entrar); branchIds son
  // TODAS las que tiene asignadas. Un usuario puede estar en varias, y su rol es
  // el mismo en todas porque el rol vive en la empresa, no en la sucursal.
  branchId: string | null;
  branchIds: string[];
  roleIds: string[];
  emailConfirmedAt: string | null;
}

interface RoleOption { id: string; name: string; }

interface BranchOption { id: string; name: string; maxUsers: number | null; }

// Usuario cuya empresa PRINCIPAL es otra, pero que tiene acceso a esta
// empresa vía profile_companies (multi-empresa).
interface LinkedUser {
  id: string;
  name: string;
  email: string;
  primaryCompanyName: string;
}

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

  // Ver "los usuarios de la sucursal X" sin salir de aquí.
  const [filtroSucursal, setFiltroSucursal] = useState<string>('todas');

  // Cupos: cuántos usuarios admite la empresa y cuántos cada sucursal. Se editan
  // aquí porque es el único sitio donde se ven junto a los usuarios reales; antes
  // estaban repartidos entre el formulario de empresa y el de cada sucursal.
  // Se guardan como texto para que vacío pueda significar "sin límite" (null).
  const [cupoEmpresa, setCupoEmpresa] = useState('');
  const [cupoSucursal, setCupoSucursal] = useState<Record<string, string>>({});
  const [cuposSaving, setCuposSaving] = useState(false);

  // Vincular un usuario EXISTENTE (de otra empresa) a esta empresa.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkedUsers, setLinkedUsers] = useState<LinkedUser[]>([]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [{ data: profs }, { data: bs }, { data: rls }, { data: links }, { data: comp }, { data: pbs }] = await Promise.all([
      supabase.from('profiles').select('id, name, email, role, is_super_admin, branch_id, email_confirmed_at, profile_roles(role_id)').eq('company_id', companyId).order('name'),
      supabase.from('branches').select('id, name, max_users').eq('company_id', companyId).order('name'),
      supabase.from('roles').select('id, name').eq('company_id', companyId).eq('is_system', false).order('name'),
      // Usuarios con acceso a esta empresa cuya empresa principal es OTRA.
      supabase.from('profile_companies').select('profiles(id, name, email, company_id, companies!profiles_company_id_fkey(name))').eq('company_id', companyId),
      supabase.from('companies').select('max_users').eq('id', companyId).single(),
      // Asignaciones reales a sucursales: un usuario puede tener varias.
      supabase.from('profile_branches').select('profile_id, branch_id').eq('company_id', companyId),
    ]);

    // Se unen las dos vías por las que un perfil queda en una sucursal:
    // profile_branches (la asignación) y profiles.branch_id (la de por defecto).
    // Hay perfiles antiguos que solo tienen la segunda, y si se ignorara
    // aparecerían como "sin sucursal" en el panel.
    const porPerfil = new Map<string, Set<string>>();
    for (const pb of (pbs ?? []) as any[]) {
      if (!porPerfil.has(pb.profile_id)) porPerfil.set(pb.profile_id, new Set());
      porPerfil.get(pb.profile_id)!.add(pb.branch_id);
    }
    setUsers((profs ?? []).map((p: any) => {
      const ids = porPerfil.get(p.id) ?? new Set<string>();
      if (p.branch_id) ids.add(p.branch_id);
      return {
        id: p.id, name: p.name ?? 'Usuario', email: p.email ?? '',
        role: p.role, isSuperAdmin: p.is_super_admin === true, branchId: p.branch_id,
        branchIds: [...ids],
        roleIds: (p.profile_roles ?? []).map((pr: any) => pr.role_id),
        emailConfirmedAt: p.email_confirmed_at,
      };
    }));
    setBranches((bs ?? []).map((b: any) => ({ id: b.id, name: b.name, maxUsers: b.max_users ?? null })));
    setCupoEmpresa((comp as any)?.max_users != null ? String((comp as any).max_users) : '');
    setCupoSucursal(
      Object.fromEntries((bs ?? []).map((b: any) => [b.id, b.max_users != null ? String(b.max_users) : ''])),
    );
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

  // Vacío = sin límite. Se valida aquí para dar un mensaje claro; la base tiene la
  // última palabra igualmente.
  const aCupo = (v: string): number | null | 'malo' => {
    if (v.trim() === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 ? n : 'malo';
  };

  // Usuarios que ocupan la empresa: los suyos más los vinculados desde otra
  // empresa, que es como los cuenta check_company_membership_limit en la base.
  const usadosEmpresa = users.filter((u) => !u.isSuperAdmin).length + linkedUsers.length;
  // Cuenta a todo el que tenga la sucursal asignada, no solo a quien la tenga como
  // sucursal por defecto: es así como la cuenta branch_user_count en la base.
  const usadosEnSucursal = (branchId: string) =>
    users.filter((u) => !u.isSuperAdmin && u.branchIds.includes(branchId)).length;

  const usuariosVisibles =
    filtroSucursal === 'todas' ? users
      : filtroSucursal === 'sin' ? users.filter((u) => u.branchIds.length === 0)
      : users.filter((u) => u.branchIds.includes(filtroSucursal));

  const enVarias = users.filter((u) => !u.isSuperAdmin && u.branchIds.length > 1).length;
  const sinSucursal = users.filter((u) => !u.isSuperAdmin && u.branchIds.length === 0).length;
  const nombreSucursal = (id: string) => branches.find((b) => b.id === id)?.name ?? 'Sucursal';

  const cupoEmpresaNum = aCupo(cupoEmpresa);
  const asignadoASucursales = branches.reduce((acc, b) => {
    const n = aCupo(cupoSucursal[b.id] ?? '');
    return acc + (typeof n === 'number' ? n : 0);
  }, 0);
  // Que la suma pase del cupo de la empresa no es un error: cada sucursal tiene su
  // propio techo y el cupo de la empresa bloquea por su cuenta. Solo se avisa.
  const seExcede = typeof cupoEmpresaNum === 'number' && asignadoASucursales > cupoEmpresaNum;

  const handleGuardarCupos = async () => {
    if (!companyId) return;
    const empresa = aCupo(cupoEmpresa);
    if (empresa === 'malo') {
      toast({ title: 'Número inválido', description: 'El cupo de la empresa debe ser 1 o más, o vacío para no poner límite.', variant: 'destructive' });
      return;
    }
    for (const b of branches) {
      if (aCupo(cupoSucursal[b.id] ?? '') === 'malo') {
        toast({ title: 'Número inválido', description: `El cupo de ${b.name} debe ser 1 o más, o vacío para no poner límite.`, variant: 'destructive' });
        return;
      }
    }

    setCuposSaving(true);
    try {
      const { error: eComp } = await supabase
        .from('companies').update({ max_users: empresa }).eq('id', companyId);
      if (eComp) throw eComp;

      // Solo las sucursales que cambiaron, para no escribir de más.
      for (const b of branches) {
        const nuevo = aCupo(cupoSucursal[b.id] ?? '') as number | null;
        if (nuevo === b.maxUsers) continue;
        const { error } = await supabase
          .from('branches').update({ max_users: nuevo }).eq('id', b.id);
        if (error) throw error;
      }

      toast({ title: 'Cupos guardados' });
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudieron guardar los cupos', description: err?.message ?? 'Error desconocido.', variant: 'destructive' });
    } finally {
      setCuposSaving(false);
    }
  };

  // Guarda el conjunto de sucursales de un usuario. Se calcula el diff en vez de
  // borrar todo y reinsertar: si una sucursal está llena, el insert rebota y con
  // el borrado previo el usuario habría quedado sin ninguna.
  //
  // El borrado anterior tampoco filtraba por empresa, así que a un usuario
  // multi-empresa le barría también las sucursales de sus OTRAS empresas.
  const handleSaveBranches = async (user: CompanyUser, nuevos: string[]) => {
    if (!companyId) return;
    const antes = new Set(user.branchIds);
    const despues = new Set(nuevos);
    const quitar = [...antes].filter((id) => !despues.has(id));
    const agregar = [...despues].filter((id) => !antes.has(id));
    if (quitar.length === 0 && agregar.length === 0) return;

    setBusy(user.id, true);
    try {
      if (quitar.length > 0) {
        const { error } = await supabase
          .from('profile_branches')
          .delete()
          .eq('profile_id', user.id)
          .eq('company_id', companyId)
          .in('branch_id', quitar);
        if (error) throw error;
      }

      if (agregar.length > 0) {
        const { error } = await supabase.from('profile_branches').insert(
          agregar.map((branch_id) => ({ profile_id: user.id, branch_id, company_id: companyId })),
        );
        if (error) throw error;
      }

      // La sucursal por defecto tiene que ser una de las asignadas: si se le quitó
      // la que tenía, pasa a la primera que quede (o a ninguna).
      const defecto = user.branchId && despues.has(user.branchId)
        ? user.branchId
        : (nuevos[0] ?? null);
      if (defecto !== user.branchId) {
        const { error } = await supabase.from('profiles').update({ branch_id: defecto }).eq('id', user.id);
        if (error) throw error;
      }

      toast({ title: 'Sucursales actualizadas', description: user.name });
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudo asignar', description: err?.message ?? 'Error desconocido.', variant: 'destructive' });
      // Recargar para que la pantalla no quede mostrando un estado que no se guardó.
      await load();
    } finally {
      setBusy(user.id, false);
    }
  };

  const handleRoleChange = async (user: CompanyUser, newRole: 'admin' | 'cashier') => {
    if (newRole === user.role || !companyId) return;
    setBusy(user.id, true);
    try {
      // Fuente de verdad: el rol vive en la membresía perfil↔empresa. El trigger
      // de lockout impide dejar la empresa sin admin (el error llega al toast).
      const { error: pcError } = await supabase
        .from('profile_companies')
        .upsert({ profile_id: user.id, company_id: companyId, role: newRole }, { onConflict: 'profile_id,company_id' });
      if (pcError) throw pcError;
      // Caché del rol activo: estos usuarios tienen esta empresa como activa.
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
      // Tocar SOLO los roles de esta empresa: el perfil puede tener roles
      // personalizados de sus otras empresas y no hay que borrárselos.
      const companyRoleIds = roles.map((r) => r.id);
      const nextCompanyRoleIds = nextRoleIds.filter((id) => companyRoleIds.includes(id));
      if (companyRoleIds.length > 0) {
        await supabase.from('profile_roles').delete().eq('profile_id', user.id).in('role_id', companyRoleIds);
      }
      if (nextCompanyRoleIds.length > 0) {
        const { error } = await supabase.from('profile_roles').insert(nextCompanyRoleIds.map((roleId) => ({ profile_id: user.id, role_id: roleId })));
        if (error) throw error;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, roleIds: nextRoleIds } : u)));
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo actualizar el rol.', variant: 'destructive' });
    } finally {
      setBusy(user.id, false);
    }
  };

  // Envía el correo de "olvidé mi contraseña" — funciona sin importar si el
  // usuario ya confirmó su cuenta o no.
  const handleSendReset = async (user: CompanyUser) => {
    setBusy(user.id, true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) throw error;
      toast({ title: 'Enlace enviado', description: `Se envió un correo a ${user.email} para restablecer su contraseña.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo enviar el correo.', variant: 'destructive' });
    } finally {
      setBusy(user.id, false);
    }
  };

  // Reenvía el correo de confirmación de cuenta (solo aplica si aún no confirmó).
  const handleResendConfirm = async (user: CompanyUser) => {
    setBusy(user.id, true);
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
      toast({ title: 'Acceso retirado', description: `${lu.name} ya no puede entrar a ${companyName}.` });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo desvincular.', variant: 'destructive' });
    } finally {
      setBusy(lu.id, false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* 4xl y no 2xl: con la columna de sucursales la tabla tiene 5 columnas y
            en 2xl se salían "Roles adicionales" y "Acciones". */}
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Usuarios de {companyName}</DialogTitle>
            <DialogDescription>Define cuántos usuarios admite la empresa y cada sucursal, y gestiona quién los ocupa.</DialogDescription>
          </DialogHeader>

          {/* CUPOS. Todo el control de límites en un solo sitio, con el conteo real
              al lado de cada número para no tener que sumar de cabeza. */}
          <div className="rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cupos</span>
              <Button size="sm" onClick={handleGuardarCupos} disabled={cuposSaving || loading}>
                {cuposSaving ? 'Guardando…' : 'Guardar cupos'}
              </Button>
            </div>

            <div className="divide-y">
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm font-medium">Empresa</span>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-20 text-center"
                  placeholder="—"
                  value={cupoEmpresa}
                  onChange={(e) => setCupoEmpresa(e.target.value)}
                />
                <span className="w-24 text-right text-xs text-muted-foreground">
                  {usadosEmpresa} en uso
                </span>
              </div>

              {branches.map((b) => {
                const usados = usadosEnSucursal(b.id);
                const tope = aCupo(cupoSucursal[b.id] ?? '');
                const completa = typeof tope === 'number' && usados >= tope;
                return (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 pl-3 text-sm text-muted-foreground">{b.name}</span>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-20 text-center"
                      placeholder="—"
                      value={cupoSucursal[b.id] ?? ''}
                      onChange={(e) => setCupoSucursal((prev) => ({ ...prev, [b.id]: e.target.value }))}
                    />
                    <span className="w-24 text-right text-xs">
                      <span className={completa ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                        {usados} en uso
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="border-t px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Un campo vacío (—) significa sin límite.
              </span>
              {typeof cupoEmpresaNum === 'number' && branches.length > 0 && (
                <span className={seExcede ? 'ml-2 font-medium text-amber-600 dark:text-amber-500' : 'ml-2 text-muted-foreground'}>
                  · {asignadoASucursales} asignados entre sucursales de {cupoEmpresaNum} de la empresa
                  {seExcede
                    ? ' — más de lo que tiene la empresa. Se permite, pero el cupo de la empresa manda al crear usuarios.'
                    : ` · ${cupoEmpresaNum - asignadoASucursales} sin asignar`}
                </span>
              )}
            </div>
          </div>

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
                <PasswordInput id="addPassword" placeholder="Mínimo 6 caracteres" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
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

          {/* Ver el pool completo o solo los de una sucursal. */}
          {!addOpen && !linkOpen && branches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Select value={filtroSucursal} onValueChange={setFiltroSucursal}>
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos los usuarios ({users.length})</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({usadosEnSucursal(b.id)})
                    </SelectItem>
                  ))}
                  {sinSucursal > 0 && (
                    <SelectItem value="sin">Sin sucursal ({sinSucursal})</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {enVarias > 0 && (
                <span className="text-muted-foreground">
                  {enVarias} {enVarias === 1 ? 'usuario está' : 'usuarios están'} en más de una sucursal
                </span>
              )}
            </div>
          )}

          {/* overflow-x-auto y no overflow-hidden: si la tabla no cabe (pantalla
              estrecha) tiene que poder desplazarse, no recortarse. */}
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Sucursales</TableHead>
                  <TableHead>Roles adicionales</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
                ) : usuariosVisibles.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {users.length === 0
                      ? 'Sin usuarios todavía.'
                      : filtroSucursal === 'sin'
                        ? 'Todos los usuarios tienen sucursal asignada.'
                        : `Ningún usuario asignado a ${nombreSucursal(filtroSucursal)}.`}
                  </TableCell></TableRow>
                ) : (
                  usuariosVisibles.map((u) => (
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
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-auto min-h-8 w-full min-w-[150px] justify-start py-1 text-xs font-normal"
                              disabled={rowBusy[u.id] || branches.length === 0}
                            >
                              {u.branchIds.length === 0 ? (
                                <span className="text-muted-foreground">Sin sucursal</span>
                              ) : (
                                <span className="flex flex-wrap gap-1">
                                  {u.branchIds.map((id) => (
                                    <Badge
                                      key={id}
                                      variant="secondary"
                                      className="px-1.5 py-0 text-[10px] font-normal"
                                    >
                                      {nombreSucursal(id)}
                                      {/* La de por defecto es donde aterriza al entrar. */}
                                      {id === u.branchId && u.branchIds.length > 1 && ' ★'}
                                    </Badge>
                                  ))}
                                </span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64" align="start">
                            <p className="mb-2 text-xs font-medium">Sucursales de {u.name}</p>
                            <BranchChecklist
                              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
                              selectedIds={u.branchIds}
                              onChange={(ids) => handleSaveBranches(u, ids)}
                              idPrefix={`suc-${u.id}`}
                            />
                            {u.branchIds.length > 1 && (
                              <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                                ★ es la sucursal donde entra por defecto. Su rol
                                ({u.role === 'admin' ? 'Administrador' : 'Cajero'}) es el mismo en todas.
                              </p>
                            )}
                          </PopoverContent>
                        </Popover>
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
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={rowBusy[u.id]}>
                              <span className="sr-only">Abrir menú</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setTimeout(() => handleSendReset(u), 0)}>
                              <Mail className="mr-2 h-4 w-4" />
                              <span>Enviar restablecimiento</span>
                            </DropdownMenuItem>
                            {!u.emailConfirmedAt && (
                              <DropdownMenuItem onSelect={() => setTimeout(() => handleResendConfirm(u), 0)}>
                                <Mail className="mr-2 h-4 w-4 text-amber-500" />
                                <span className="text-amber-500 font-medium">Reenviar confirmación</span>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => setTimeout(() => setDeleteTarget(u), 0)}
                              disabled={u.id === appUser?.id}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              <span>Eliminar</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
