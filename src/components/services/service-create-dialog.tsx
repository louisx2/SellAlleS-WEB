import { useState, useEffect } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Customer, ServiceType, User } from '@/lib/types';
import { serviceToRow } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

interface ServiceCreateDialogProps {
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function ServiceCreateDialog({ onSuccess, children }: ServiceCreateDialogProps) {
  const { toast } = useToast();
  const { appUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [selectedCustomer, setSelectedCustomer] = useState<string>('none');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('none');

  useEffect(() => {
    if (open) {
      // Fetch customers
      supabase.from('customers').select('id, name').order('name').then(({ data }) => {
        if (data) setCustomers(data as unknown as Customer[]);
      });
      // Fetch service types
      supabase.from('service_types').select('id, name, base_price').order('name').then(({ data }) => {
        if (data) setServiceTypes(data.map(d => ({ id: d.id, name: d.name, basePrice: Number(d.base_price) })) as ServiceType[]);
      });
      // Fetch users (profiles)
      supabase.from('profiles').select('id, name').order('name').then(({ data }) => {
        if (data) setUsers(data as unknown as User[]);
      });
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const description = formData.get('description') as string;
    
    if (!selectedType) {
        toast({ title: 'Selecciona un tipo de servicio', variant: 'destructive' });
        return;
    }

    try {
      const { data: profile } = await supabase.from('profiles').select('company_id, branches!profiles_branch_id_fkey(id)').eq('id', appUser?.id).single();
      if (!profile) throw new Error('No profile data');

      const branchesData = profile.branches as any;
      const branchId = Array.isArray(branchesData) ? branchesData[0]?.id : branchesData?.id;

      const serviceTypeId = selectedType;
      const st = serviceTypes.find(t => t.id === serviceTypeId);

      const insertData = {
        company_id: profile.company_id,
        branch_id: branchId,
        customer_id: selectedCustomer && selectedCustomer !== 'none' ? selectedCustomer : null,
        service_type_id: serviceTypeId,
        assigned_to: selectedUser && selectedUser !== 'none' ? selectedUser : null,
        description: description,
        status: 'pending',
        labor_price: st?.basePrice || 0,
        parts_total: 0,
        total: st?.basePrice || 0,
        payment_status: 'pending',
        amount_paid: 0,
      };

      const { error } = await supabase.from('services').insert(insertData);
      if (error) throw error;
      
      toast({ title: 'Servicio creado' });
      setOpen(false);
      onSuccess?.();
    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error al crear', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Servicio</DialogTitle>
          <DialogDescription>
            Registra un nuevo servicio o reparación.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Cliente</Label>
              <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Selecciona un cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Cliente Genérico (Mostrador)</SelectItem>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Tipo</Label>
              <Select value={selectedType} onValueChange={setSelectedType} required>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Tipo de servicio..." />
                </SelectTrigger>
                <SelectContent>
                  {serviceTypes.map(st => (
                    <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Asignar a</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Técnico / Usuario..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin Asignar</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="description" className="text-right mt-2">Equipo / Falla</Label>
              <Input id="description" name="description" placeholder="Ej. iPhone 13 - Pantalla rota" className="col-span-3" required />
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">Crear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
