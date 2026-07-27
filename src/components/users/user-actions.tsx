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
import { usePermission } from '@/hooks/use-permission';
import { supabase } from '@/lib/supabase/client';
import { PasswordInput } from '@/components/ui/password-input';

interface UserActionsProps {
  user: User;
}

export function UserActions({ user }: UserActionsProps) {
  const { toast } = useToast();
  const { deleteUser, setPassword, sendPasswordReset } = useUsers();
  const canEdit = usePermission('users', 'edit');
  const canDelete = usePermission('users', 'delete');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [working, setWorking] = useState(false);

  const handleSetPassword = async () => {
    if (newPwd.length < 8) {
      toast({ title: 'ContraseÃƒÂ±a dÃƒÂ©bil', description: 'La contraseÃƒÂ±a debe tener al menos 8 caracteres.', variant: 'destructive' });
      return;
    }
    if (!/[A-Z]/.test(newPwd)) {
      toast({ title: 'ContraseÃƒÂ±a dÃƒÂ©bil', description: 'La contraseÃƒÂ±a debe incluir al menos una letra mayÃƒÂºscula.', variant: 'destructive' });
      return;
    }
    if (!/[a-z]/.test(newPwd)) {
      toast({ title: 'ContraseÃƒÂ±a dÃƒÂ©bil', description: 'La contraseÃƒÂ±a debe incluir al menos una letra minÃƒÂºscula.', variant: 'destructive' });
      return;
    }
    if (!/\d/.test(newPwd)) {
      toast({ title: 'ContraseÃƒÂ±a dÃƒÂ©bil', description: 'La contraseÃƒÂ±a debe incluir al menos un nÃƒÂºmero.', variant: 'destructive' });
      return;
    }
    if (!/[@$!%*?&._\-\/#]/.test(newPwd)) {
      toast({ title: 'ContraseÃƒÂ±a dÃƒÂ©bil', description: 'La contraseÃƒÂ±a debe incluir al menos un carÃƒÂ¡cter especial (ej: @$!%*?&._-/#).', variant: 'destructive' });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({ title: 'ContraseÃƒÂ±as no coinciden', description: 'Las contraseÃƒÂ±as ingresadas no son iguales.', variant: 'destructive' });
      return;
    }

    setWorking(true);
    try {
      await setPassword(user.id, newPwd);
      toast({ title: 'ContraseÃƒÂ±a actualizada', description: `Se fijÃƒÂ³ una nueva contraseÃƒÂ±a para ${user.name}.` });
      setPwdOpen(false);
      setNewPwd('');
      setConfirmPwd('');
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
        description: `Se enviÃƒÂ³ un correo a ${user.email} para restablecer su contraseÃƒÂ±a.`,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo enviar el correo.', variant: 'destructive' });
    }
  };

  const handleResendConfirm = async () => {
    setWorking(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: {
          emailRedirectTo: `${window.location.origin}/login`
        }
      });
      if (error) throw error;
      toast({
        title: 'Correo de confirmaciÃƒÂ³n enviado',
        description: `Se ha reenviado el enlace de confirmaciÃƒÂ³n a ${user.email}.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error al enviar',
        description: err?.message ?? 'No se pudo reenviar el correo de confirmaciÃƒÂ³n.',
        variant: 'destructive',
      });
    } finally {
      setWorking(false);
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
            <span className="sr-only">Abrir menÃƒÂº</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canEdit && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setEditOpen(true), 0)}>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Editar</span>
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setPwdOpen(true), 0)}>
              <KeyRound className="mr-2 h-4 w-4" />
              <span>Fijar contraseÃƒÂ±a</span>
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setTimeout(handleReset, 0)}>
              <Mail className="mr-2 h-4 w-4" />
              <span>Enviar correo de restablecimiento</span>
            </DropdownMenuItem>
          )}
          {canEdit && !user.emailConfirmedAt && (
            <DropdownMenuItem onSelect={() => setTimeout(handleResendConfirm, 0)} disabled={working}>
              <Mail className="mr-2 h-4 w-4 text-amber-500" />
              <span className="text-amber-500 font-medium">Reenviar confirmaciÃƒÂ³n</span>
            </DropdownMenuItem>
          )}
          {canDelete && <DropdownMenuSeparator />}
          {canDelete && (
          <DropdownMenuItem
            onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <UserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={pwdOpen} onOpenChange={(o) => { setPwdOpen(o); if (!o) { setNewPwd(''); setConfirmPwd(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fijar contraseÃƒÂ±a</DialogTitle>
            <DialogDescription>
              Escribe la nueva contraseÃƒÂ±a para {user.name}. El usuario podrÃƒÂ¡ entrar con ella de inmediato.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="newPwd">Nueva contraseÃƒÂ±a</Label>
              <PasswordInput
                id="newPwd" value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="MÃƒÂ­nimo 8 caracteres, mayÃƒÂºscula, especial"
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPwd">Confirmar contraseÃƒÂ±a</Label>
              <PasswordInput
                id="confirmPwd" value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repite la contraseÃƒÂ±a"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)} disabled={working}>Cancelar</Button>
            <Button onClick={handleSetPassword} disabled={working}>{working ? 'GuardandoÃ¢â‚¬Â¦' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ã‚Â¿Eliminar a {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarÃƒÂ¡ su cuenta por completo (perfil y acceso). Esta acciÃƒÂ³n no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? 'EliminandoÃ¢â‚¬Â¦' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
