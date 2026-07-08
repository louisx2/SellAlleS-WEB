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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { ServiceType } from '@/lib/types';
import { serviceTypeToRow } from '@/lib/supabase/mappers';

interface ServiceTypeDialogProps {
  serviceType?: ServiceType;
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function ServiceTypeDialog({ serviceType, onSuccess, children }: ServiceTypeDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!serviceType;
  const [open, setOpen] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const data = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      basePrice: Number(formData.get('basePrice')),
    };

    try {
      if (isEditMode && serviceType) {
        const { error } = await supabase
          .from('service_types')
          .update(serviceTypeToRow(data))
          .eq('id', serviceType.id);
        if (error) throw error;
        toast({ title: 'Tipo de servicio actualizado' });
      } else {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error('No auth');
        
        // Obtenemos company_id del profile actual
        const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', userData.user.id).single();
        if (!profile) throw new Error('No profile');

        const insertData = { ...serviceTypeToRow(data), company_id: profile.company_id };
        const { error } = await supabase.from('service_types').insert(insertData);
        if (error) throw error;
        toast({ title: 'Tipo de servicio creado' });
      }
      setOpen(false);
      onSuccess?.();
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error al guardar', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Tipo de Servicio' : 'Nuevo Tipo de Servicio'}</DialogTitle>
          <DialogDescription>
            Configura los detalles de este tipo de servicio.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">Nombre</Label>
              <Input id="name" name="name" defaultValue={serviceType?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">Descripción</Label>
              <Input id="description" name="description" defaultValue={serviceType?.description} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="basePrice" className="text-right">Precio Base</Label>
              <Input id="basePrice" name="basePrice" type="number" step="0.01" defaultValue={serviceType?.basePrice ?? 0} className="col-span-3" required />
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">{isEditMode ? 'Guardar Cambios' : 'Crear'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
