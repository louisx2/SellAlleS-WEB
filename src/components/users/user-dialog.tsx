'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useUsers } from '@/context/user-provider';
import { useBranches } from '@/context/branch-provider';

interface UserDialogProps {
  user?: User;
  children: React.ReactNode;
}

export function UserDialog({ user, children }: UserDialogProps) {
  const { toast } = useToast();
  const { addUser, updateUser } = useUsers();
  const { branches } = useBranches();
  const isEditMode = !!user;
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user?.role ?? 'cashier');
  const [branch, setBranch] = useState(user?.branch ?? '');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = formData.get('password') as string | null;

    if (!isEditMode && !password) {
        toast({ title: 'Contraseña requerida', description: 'Debes introducir una contraseña para el nuevo usuario.', variant: 'destructive'});
        return;
    }

    const newUserData = {
      id: user?.id ?? '',
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      branch: branch,
      role: role as 'admin' | 'cashier',
    };

    try {
        if (isEditMode && user) {
          await updateUser({ ...user, ...newUserData });
          toast({
            title: `Usuario actualizado`,
            description: `El usuario '${newUserData.name}' ha sido actualizado.`,
          });
        } else {
          await addUser(newUserData, password!);
          toast({
            title: `Usuario añadido`,
            description: `El usuario '${newUserData.name}' ha sido añadido.`,
          });
        }
        setOpen(false);
    } catch(error: any) {
        let description = 'Ocurrió un error inesperado.';
        if (error.code === 'auth/email-already-in-use') {
            description = 'Este correo electrónico ya está en uso por otro usuario.';
        } else if (error.code === 'auth/weak-password') {
            description = 'La contraseña es demasiado débil. Debe tener al menos 6 caracteres.';
        }
        console.error("Error saving user:", error);
        toast({ title: 'Error al guardar', description, variant: 'destructive'});
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Usuario' : 'Añadir Usuario'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del usuario.' : 'Añade un nuevo usuario y asígnale un rol.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={user?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input id="email" name="email" type="email" defaultValue={user?.email} className="col-span-3" required />
            </div>
             {!isEditMode && (
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="password" className="text-right">
                        Contraseña
                    </Label>
                    <Input id="password" name="password" type="password" className="col-span-3" required />
                </div>
            )}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="role" className="text-right">
                Rol
              </Label>
               <Select name="role" value={role} onValueChange={(value) => setRole(value as 'admin' | 'cashier')}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="cashier">Cajero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="branch" className="text-right">
                Sucursal
            </Label>
            <Select name="branch" value={branch} onValueChange={setBranch} required>
                <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Selecciona una sucursal" />
                </SelectTrigger>
                <SelectContent>
                {branches.map(b => (
                    <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                ))}
                {branches.length === 0 && <p className="p-4 text-sm text-muted-foreground">Crea una sucursal primero.</p>}
                </SelectContent>
            </Select>
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">{isEditMode ? 'Guardar Cambios' : 'Crear Usuario'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
