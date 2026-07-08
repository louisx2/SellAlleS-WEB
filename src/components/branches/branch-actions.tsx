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
import { BranchDialog } from './branch-dialog';
import type { Branch } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';

interface BranchActionsProps {
  branch: Branch;
}

export function BranchActions({ branch }: BranchActionsProps) {
  const { toast } = useToast();
  const { appUser } = useAuth();
  
  const handleDelete = () => {
    toast({
      title: 'Acción no implementada',
      description: `La eliminación de sucursales no está disponible en esta demo.`,
      variant: 'destructive',
    });
  };

  return (
    <BranchDialog branch={branch}>
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
          <DropdownMenuItem asChild>
            <div>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Editar</span>
            </div>
          </DropdownMenuItem>
          {appUser?.isSuperAdmin && (
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              <span>Eliminar</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </BranchDialog>
  );
}
