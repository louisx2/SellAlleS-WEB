'use client';

import { useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, KeyRound, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { UserDialog } from './user-dialog';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useUsers } from '@/context/user-provider';

interface UserActionsProps {
  user: User;
}

export function UserActions({ user }: UserActionsProps) {
  const { toast } = useToast();
  const { deleteUser, setPassword, sendPasswordReset } = useUsers();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [working, setWorking] = useState(false);

  const handleSetPassword = async () => {
    if (newPwd.length < 6) {
      toast({ title: 'Contraseña débil', description: 'Debe tener al menos 6 caracteres.', variant: 'destructive' });
      return;
    }
    setWorking(true);
    try {
      await setPassword(user.id, newPwd);
      toast({ title: 'Contraseña actualizada', description: `Se fijó una nueva contraseña para ${user.name}.` });
      setPwdOpen(false);
      setNewPwd('');
    } catch (err: any) {
      toast({ title: 'No se pudo cambiar', description: err?.message ?? 'Error.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handleReset = async () => {
    try {
      await sendPasswordReset(user.email);
      toast({
        title: 'Enlace enviado',
        description: `Se envió un correo a ${user.email} para restablecer su contraseña.`,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo enviar el correo.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    setWorking(true);
    try {
      await deleteUser(user.id);
      toast({ title: 'Usuario eliminado', description: `${user.name} fue eliminado de la empresa.` });
      setDeleteOpen(false);
    } catch (err: any) {
      toast({ title: 'No se pudo eliminar', description: err?.message ?? 'Error al eliminar.', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
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
          <DropdownMenuItem onSelect={() => setTimeout(() => setEditOpen(true), 0)}>
            <Pencil className="mr-2 h-4 w-4" />
            <span>Editar</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTimeout(() => setPwdOpen(true), 0)}>
            <KeyRound className="mr-2 h-4 w-4" />
            <span>Fijar contraseña</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTimeout(handleReset, 0)}>
            <Mail className="mr-2 h-4 w-4" />
            <span>Enviar correo de restablecimiento</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={pwdOpen} onOpenChange={(o) => { setPwdOpen(o); if (!o) setNewPwd(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fijar contraseña</DialogTitle>
            <DialogDescription>
              Escribe la nueva contraseña para {user.name}. El usuario podrá entrar con ella de inmediato.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="newPwd">Nueva contraseña</Label>
            <Input
              id="newPwd"
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
            />
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
            <AlertDialogTitle>¿Eliminar a {user.name}?</AlertDialogTitle>
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
    </>
  );
}
