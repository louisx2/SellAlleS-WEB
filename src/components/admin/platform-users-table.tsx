'use client';

import { useMemo, useState } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Store, Pencil, Search, Filter, UserCog, MoreHorizontal, KeyRound, Trash2 } from 'lucide-react';
import type { Company } from '@/lib/types';
import type { PlatformBranch, PlatformUser } from '@/app/(app)/admin/users/page';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';

interface PlatformUsersTableProps {
  users: PlatformUser[];
  companies: Company[];
  branches: PlatformBranch[];
  loading: boolean;
  onEditUser: (u: PlatformUser) => void;
  onRefresh: () => void;
}

const ALL = 'all';

export function PlatformUsersTable({ users, companies, branches, loading, onEditUser, onRefresh }: PlatformUsersTableProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string>(ALL);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [working, setWorking] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);

  const companyName = useMemo(() => {
    const map: Record<string, string> = {};
    companies.forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [companies]);

  const branchesForFilter = useMemo(
    () => (companyFilter === ALL ? branches : branches.filter((b) => b.companyId === companyFilter)),
    [branches, companyFilter]
  );

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesCompany = companyFilter === ALL || u.companyId === companyFilter;
    const matchesBranch = branchFilter === ALL || u.branchId === branchFilter;
    return matchesSearch && matchesCompany && matchesBranch;
  });

  const handleSetPassword = async () => {
    if (!selectedUser) return;
    if (newPwd.length < 8) {
      toast({ title: 'Contraseña débil', description: 'La contraseña debe tener al menos 8 caracteres.', variant: 'destructive' });
      return;
    }
    if (!/[A-Z]/.test(newPwd)) {
      toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos una letra mayúscula.', variant: 'destructive' });
      return;
    }
    if (!/[a-z]/.test(newPwd)) {
      toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos una letra minúscula.', variant: 'destructive' });
      return;
    }
    if (!/\d/.test(newPwd)) {
      toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos un número.', variant: 'destructive' });
      return;
    }
    if (!/[@$!%*?&._\-\/#]/.test(newPwd)) {
      toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos un carácter especial (ej: @$!%*?&._-/#).', variant: 'destructive' });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({ title: 'Contraseñas no coinciden', description: 'Las contraseñas ingresadas no son iguales.', variant: 'destructive' });
      return;
    }

    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'set_password', userId: selectedUser.id, password: newPwd },
      });
      if (error) throw new Error((data as any)?.error ?? error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({ title: 'Contraseña actualizada', description: `Se fijó una nueva contraseña para ${selectedUser.name}.` });
      setPwdOpen(false);
      setNewPwd('');
      setConfirmPwd('');
      
      // Aplicar regla de recarga nativa para evitar pointer-events congelados
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      toast({ title: 'No se pudo cambiar', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'delete', userId: selectedUser.id },
      });
      if (error) throw new Error((data as any)?.error ?? error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({ title: 'Usuario eliminado', description: `${selectedUser.name} fue eliminado de la plataforma.` });
      setDeleteOpen(false);
      
      // Aplicar regla de recarga nativa para evitar pointer-events congelados
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      toast({ title: 'No se pudo eliminar', description: err?.message ?? 'Error al eliminar.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            className="pl-9 bg-muted/50 border-transparent focus-visible:bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <Select
            value={companyFilter}
            onValueChange={(v) => { setCompanyFilter(v); setBranchFilter(ALL); }}
          >
            <SelectTrigger className="w-full sm:w-[200px] bg-muted/50 border-transparent focus:bg-background">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las empresas</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-muted/50 border-transparent focus:bg-background">
              <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las sucursales</SelectItem>
              {branchesForFilter.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[260px]">Usuario</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Roles adicionales</TableHead>
              <TableHead>Verificación</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Cargando usuarios...</TableCell></TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No se encontraron usuarios.</TableCell></TableRow>
            ) : (
              filteredUsers.map((u) => (
                <TableRow key={u.id} className="group hover:bg-muted/10 transition-colors">
                  <TableCell className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                        <UserCog className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium leading-none">{u.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {u.companyId ? (companyName[u.companyId] ?? '—') : '—'}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Store className="h-3.5 w-3.5 text-muted-foreground" />
                      {u.branchName || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? 'Administrador' : (u.customRoles[0]?.name ?? 'Cajero')}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {u.customRoles.length > 0 ? (
                        u.customRoles.map((r) => (
                          <Badge key={r.id} variant="outline" className="text-[10px]">{r.name}</Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant={u.emailConfirmedAt ? 'outline' : 'destructive'}
                      className={u.emailConfirmedAt ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}
                    >
                      {u.emailConfirmedAt ? 'Verificado' : 'Pendiente'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-3">
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Abrir menú</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onEditUser(u)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          <span>Editar</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { setSelectedUser(u); setPwdOpen(true); }}>
                          <KeyRound className="mr-2 h-4 w-4" />
                          <span>Fijar contraseña</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => { setSelectedUser(u); setDeleteOpen(true); }}
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

      <Dialog open={pwdOpen} onOpenChange={(o) => { setPwdOpen(o); if (!o) { setNewPwd(''); setConfirmPwd(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fijar contraseña</DialogTitle>
            <DialogDescription>
              Escribe la nueva contraseña para {selectedUser?.name}. El usuario podrá entrar con ella de inmediato.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="newPwd">Nueva contraseña</Label>
              <Input
                id="newPwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Mínimo 8 caracteres, mayúscula, especial"
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPwd">Confirmar contraseña</Label>
              <Input
                id="confirmPwd"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)} disabled={working}>Cancelar</Button>
            <Button onClick={handleSetPassword} disabled={working}>{working ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {selectedUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará su cuenta por completo (perfil y acceso). Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
