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
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase/client';
import { useEffect } from 'react';

interface UserDialogProps {
  user?: User;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UserDialog({ user, children, open: controlledOpen, onOpenChange }: UserDialogProps) {
  const { toast } = useToast();
  const { addUser, updateUser } = useUsers();
  const { branches } = useBranches();
  const isEditMode = !!user;
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => { if (isControlled) onOpenChange?.(o); else setInternalOpen(o); };
  const [role, setRole] = useState(user?.role ?? 'cashier');
  const [branch, setBranch] = useState(user?.branch ?? '');
  
  const [availableRoles, setAvailableRoles] = useState<import('@/lib/types').Role[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user?.customRoles?.map(r => r.id) ?? []
  );
  const [selectedBranches, setSelectedBranches] = useState<string[]>(
    user?.branches?.map(b => b.id) ?? []
  );
  const [confirmPassword, setConfirmPassword] = useState('');
  const [allBranchesChecked, setAllBranchesChecked] = useState(false);

  useEffect(() => {
    supabase.from('roles').select('id, name, description').order('name')
      .then(({ data }) => {
        if (data) setAvailableRoles(data.map(r => ({ id: r.id, name: r.name, description: r.description ?? '' })));
      });
  }, []);

  useEffect(() => {
    if (open && user) {
        setSelectedRoles(user.customRoles?.map(r => r.id) ?? []);
        setSelectedBranches(user.branches?.map(b => b.id) ?? []);
        setRole(user.role);
        setBranch(user.branch);
    } else if (open && !user) {
        setSelectedRoles([]);
        setSelectedBranches([]);
        setRole('cashier');
        setBranch('');
        setConfirmPassword('');
    }
  }, [open, user]);

  useEffect(() => {
    if (open && branches.length > 0) {
      const primaryBranchId = branches.find(b => b.name === branch)?.id;
      const otherBranches = branches.filter(b => b.id !== primaryBranchId);
      const isAll = otherBranches.length > 0 && otherBranches.every(b => selectedBranches.includes(b.id));
      setAllBranchesChecked(isAll);
    }
  }, [open, branch, selectedBranches, branches]);

  const handleAllBranchesToggle = (checked: boolean) => {
    setAllBranchesChecked(checked);
    if (checked) {
      const primaryBranchId = branches.find(b => b.name === branch)?.id;
      const others = branches.filter(b => b.id !== primaryBranchId).map(b => b.id);
      setSelectedBranches(others);
    } else {
      setSelectedBranches([]);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = formData.get('password') as string | null;

    if (!isEditMode) {
      if (!password) {
        toast({ title: 'Contraseña requerida', description: 'Debes introducir una contraseña para el nuevo usuario.', variant: 'destructive'});
        return;
      }
      if (password.length < 8) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe tener al menos 8 caracteres.', variant: 'destructive'});
        return;
      }
      if (!/[A-Z]/.test(password)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos una letra mayúscula.', variant: 'destructive'});
        return;
      }
      if (!/[a-z]/.test(password)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos una letra minúscula.', variant: 'destructive'});
        return;
      }
      if (!/\d/.test(password)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos un número.', variant: 'destructive'});
        return;
      }
      if (!/[@$!%*?&._\-\/#]/.test(password)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe incluir al menos un carácter especial (ej: @$!%*?&._-/#).', variant: 'destructive'});
        return;
      }
      if (password !== confirmPassword) {
        toast({ title: 'Contraseñas no coinciden', description: 'Las contraseñas ingresadas no son iguales.', variant: 'destructive'});
        return;
      }
    }

    const finalBranches = allBranchesChecked
      ? branches
      : [
          ...branches.filter(b => b.name === branch),
          ...branches.filter(b => selectedBranches.includes(b.id))
        ];

    const newUserData = {
      id: user?.id ?? '',
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      branch: branch,
      role: role as 'admin' | 'cashier',
      customRoles: availableRoles.filter(r => selectedRoles.includes(r.id)),
      branches: finalBranches,
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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
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
               <>
                 <div className="grid grid-cols-4 items-center gap-4">
                     <Label htmlFor="password" className="text-right">
                         Contraseña
                     </Label>
                     <Input id="password" name="password" type="password" placeholder="Mínimo 8 caracteres" className="col-span-3" required />
                 </div>
                 <div className="grid grid-cols-4 items-center gap-4">
                     <Label htmlFor="confirmPassword" className="text-right">
                         Confirmar
                     </Label>
                     <Input id="confirmPassword" name="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repite la contraseña" className="col-span-3" required />
                 </div>
               </>
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

             {branches.length > 1 && (
                <div className="grid grid-cols-4 items-start gap-4 pt-2">
                    <Label className="text-right mt-1">Sucursales</Label>
                    <div className="col-span-3 flex flex-col gap-3">
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                              id="all-branches" 
                              checked={allBranchesChecked}
                              onCheckedChange={handleAllBranchesToggle}
                            />
                            <Label htmlFor="all-branches" className="font-semibold cursor-pointer">Asignar todas las sucursales</Label>
                        </div>
                        
                        <div className="pl-6 flex flex-col gap-2 border-l border-border mt-1">
                            {branches.map(b => {
                                const isPrimary = b.name === branch;
                                if (isPrimary) return null;

                                return (
                                    <div key={b.id} className="flex items-center space-x-2">
                                        <Checkbox 
                                          id={`branch-${b.id}`} 
                                          checked={selectedBranches.includes(b.id) || allBranchesChecked}
                                          disabled={allBranchesChecked}
                                          onCheckedChange={(checked) => {
                                              if (checked) {
                                                  setSelectedBranches(prev => [...prev, b.id]);
                                              } else {
                                                  setSelectedBranches(prev => prev.filter(id => id !== b.id));
                                              }
                                          }}
                                        />
                                        <Label htmlFor={`branch-${b.id}`} className="font-normal cursor-pointer">{b.name}</Label>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
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
            
            {availableRoles.length > 0 && (
                <div className="grid grid-cols-4 items-start gap-4 pt-2">
                    <Label className="text-right mt-1">Roles Adicionales</Label>
                    <div className="col-span-3 flex flex-col gap-2">
                        {availableRoles.map(r => (
                            <div key={r.id} className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`role-${r.id}`} 
                                  checked={selectedRoles.includes(r.id)}
                                  onCheckedChange={(checked) => {
                                      if (checked) {
                                          setSelectedRoles(prev => [...prev, r.id]);
                                      } else {
                                          setSelectedRoles(prev => prev.filter(id => id !== r.id));
                                      }
                                  }}
                                />
                                <Label htmlFor={`role-${r.id}`} className="font-normal cursor-pointer">{r.name}</Label>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
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
