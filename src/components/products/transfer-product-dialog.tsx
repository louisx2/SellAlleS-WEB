'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Product } from '@/lib/types';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { useProducts } from '@/context/product-provider';

// Valores centinela del desplegable de ubicación. No son ids.
const SIN_UBICACION = '__sin__';
const NUEVA_UBICACION = '__nueva__';

const formSchema = z
  .object({
    targetBranchId: z.string().min(1, 'Selecciona una sucursal destino'),
    quantity: z.coerce.number().positive('La cantidad debe ser mayor a 0'),
    targetLocationId: z.string().min(1, 'Elige dónde va a quedar'),
    nuevaUbicacion: z.string().optional(),
  })
  .refine(
    (v) => v.targetLocationId !== NUEVA_UBICACION || !!v.nuevaUbicacion?.trim(),
    { path: ['nuevaUbicacion'], message: 'Escribe el nombre de la ubicación' },
  );

type LocationOption = { id: string; name: string };

interface TransferProductDialogProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransferProductDialog({ product, open, onOpenChange }: TransferProductDialogProps) {
  const { toast } = useToast();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const { reload } = useProducts();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      targetBranchId: '',
      quantity: 1,
      targetLocationId: SIN_UBICACION,
      nuevaUbicacion: '',
    },
  });

  const availableBranches = branches.filter(b => b.id !== appUser?.activeBranchId);
  const targetBranchId = form.watch('targetBranchId');
  const targetLocationId = form.watch('targetLocationId');

  // Las ubicaciones son de la sucursal destino, no de la mía: un estante de
  // aquí no dice nada de dónde va a quedar la caja allá. Solo un admin abre
  // este diálogo, y la RLS de product_locations deja al admin leer y crear en
  // cualquier sucursal de su empresa.
  useEffect(() => {
    if (!targetBranchId) { setLocations([]); return; }
    let cancelado = false;
    setLoadingLocations(true);
    (async () => {
      const { data } = await supabase
        .from('product_locations')
        .select('id, name')
        .eq('branch_id', targetBranchId)
        .order('name');
      if (!cancelado) {
        setLocations((data ?? []) as LocationOption[]);
        setLoadingLocations(false);
        form.setValue('targetLocationId', SIN_UBICACION);
        form.setValue('nuevaUbicacion', '');
      }
    })();
    return () => { cancelado = true; };
  }, [targetBranchId, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (values.quantity > product.stock) {
      form.setError('quantity', { message: 'Stock insuficiente' });
      return;
    }

    setIsSubmitting(true);
    try {
      let locationId: string | null = null;
      if (values.targetLocationId === NUEVA_UBICACION) {
        const { data: creada, error: errorUbicacion } = await supabase
          .from('product_locations')
          .insert({ name: values.nuevaUbicacion!.trim(), branch_id: values.targetBranchId })
          .select('id')
          .single();
        if (errorUbicacion) throw errorUbicacion;
        locationId = creada.id;
      } else if (values.targetLocationId !== SIN_UBICACION) {
        locationId = values.targetLocationId;
      }

      const { error } = await supabase.rpc('transfer_product_stock', {
        p_product_id: product.id,
        p_quantity: values.quantity,
        p_target_branch_id: values.targetBranchId,
        p_current_branch_id: appUser?.activeBranchId,
        p_target_location_id: locationId,
      });

      if (error) throw error;

      toast({
        title: 'Transferencia exitosa',
        description: `Se han transferido ${values.quantity} unidades a la sucursal seleccionada.`,
      });
      
      await reload();
      
      onOpenChange(false);
      form.reset();
      
      // Aplicar patrón de recarga nativa solicitado en AGENTS.md
      setTimeout(() => window.location.reload(), 800);
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al transferir',
        description: error.message || 'Ha ocurrido un error inesperado',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Transferir Producto</DialogTitle>
          <DialogDescription>
            Transfiere stock de <strong>{product.name}</strong> a otra sucursal.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="targetBranchId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sucursal Destino</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona la sucursal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableBranches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cantidad (Máximo: {product.stock})</FormLabel>
                  <FormControl>
                    <Input type="number" step="any" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {targetBranchId && (
              <FormField
                control={form.control}
                name="targetLocationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>¿Dónde va a quedar en esa sucursal?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingLocations ? 'Cargando…' : 'Elige la ubicación'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={SIN_UBICACION}>Sin ubicación</SelectItem>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                        <SelectItem value={NUEVA_UBICACION}>+ Crear una ubicación nueva</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {targetLocationId === NUEVA_UBICACION && (
              <FormField
                control={form.control}
                name="nuevaUbicacion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre de la ubicación nueva</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Estante A / Segunda fila" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || availableBranches.length === 0}>
                Confirmar Transferencia
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
