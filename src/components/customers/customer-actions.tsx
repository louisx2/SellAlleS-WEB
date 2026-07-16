'use client';

import Link from 'next/link';
import { MoreHorizontal, Pencil, Trash2, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CustomerDialog } from './customer-dialog';
import type { Customer } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { DialogTrigger } from '@/components/ui/dialog';

interface CustomerActionsProps {
  customer: Customer;
}

export function CustomerActions({ customer }: CustomerActionsProps) {
  const { toast } = useToast();
  
  const handleDelete = () => {
    toast({
      title: 'Acción no implementada',
      description: `La eliminación del cliente ${customer.name} no está disponible en esta demo.`,
      variant: 'destructive',
    });
  };

  return (
    <CustomerDialog customer={customer}>
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
          <DropdownMenuItem asChild>
            <Link href={`/customers/history?id=${customer.id}`}>
              <History className="mr-2 h-4 w-4" />
              <span>Ver Historial</span>
            </Link>
          </DropdownMenuItem>
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
    </CustomerDialog>
  );
}
