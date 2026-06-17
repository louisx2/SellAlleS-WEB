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
import type { Branch } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useBranches } from '@/context/branch-provider';

interface BranchDialogProps {
  branch?: Branch;
  children: React.ReactNode;
}

export function BranchDialog({ branch, children }: BranchDialogProps) {
  const { toast } = useToast();
  const { addBranch, updateBranch } = useBranches();
  const isEditMode = !!branch;
  const [open, setOpen] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newBranchData = {
      id: branch?.id ?? '',
      name: formData.get('name') as string,
      location: formData.get('location') as string,
    };

    if (isEditMode && branch) {
      updateBranch({ ...branch, ...newBranchData });
      toast({
        title: `Sucursal actualizada`,
        description: `La sucursal '${newBranchData.name}' ha sido actualizada.`,
      });
    } else {
      addBranch(newBranchData);
      toast({
        title: `Sucursal añadida`,
        description: `La sucursal '${newBranchData.name}' ha sido añadida.`,
      });
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Sucursal' : 'Añadir Sucursal'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles de la sucursal.' : 'Añade una nueva sucursal.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={branch?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="location" className="text-right">
                Ubicación
              </Label>
              <Input id="location" name="location" defaultValue={branch?.location} className="col-span-3" required />
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
