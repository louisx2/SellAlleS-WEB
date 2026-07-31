'use client';

import { useState } from 'react';
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

const formSchema = z.object({
  targetBranchId: z.string().min(1, 'Selecciona una sucursal destino'),
  quantity: z.coerce.number().positive('La cantidad debe ser mayor a 0'),
});

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

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      targetBranchId: '',
      quantity: 1,
    },
  });

  const availableBranches = branches.filter(b => b.id !== appUser?.activeBranchId);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (values.quantity > product.stock) {
      form.setError('quantity', { message: 'Stock insuficiente' });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('transfer_product_stock', {
        p_product_id: product.id,
        p_quantity: values.quantity,
        p_target_branch_id: values.targetBranchId,
        p_current_branch_id: appUser?.activeBranchId,
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
