'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SupplierDialog } from './supplier-dialog';
import type { Supplier } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useSuppliers } from '@/context/supplier-provider';
import { DialogTrigger } from '@/components/ui/dialog';

interface SupplierActionsProps {
  supplier: Supplier;
}

export function SupplierActions({ supplier }: SupplierActionsProps) {
  const { toast } = useToast();
  const { deleteSupplier } = useSuppliers();

  const handleDelete = async () => {
    if (!confirm(`¿Estás seguro de que deseas eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await deleteSupplier(supplier.id);
      toast({
        title: 'Proveedor eliminado',
        description: `El proveedor "${supplier.name}" ha sido eliminado del catálogo.`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error al eliminar',
        description: 'No se pudo eliminar al proveedor. Inténtalo de nuevo.',
        variant: 'destructive',
      });
    }
  };

  return (
    <SupplierDialog supplier={supplier}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Acciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DialogTrigger asChild>
            <DropdownMenuItem>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Editar</span>
            </DropdownMenuItem>
          </DialogTrigger>
          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SupplierDialog>
  );
}
