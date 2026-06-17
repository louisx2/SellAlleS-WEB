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
import { UserDialog } from './user-dialog';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface UserActionsProps {
  user: User;
}

export function UserActions({ user }: UserActionsProps) {
  const { toast } = useToast();
  
  const handleDelete = () => {
    toast({
      title: 'Acción no implementada',
      description: `La eliminación del usuario ${user.name} no está disponible en esta demo.`,
      variant: 'destructive',
    });
  };

  return (
    <UserDialog user={user}>
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
          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Eliminar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </UserDialog>
  );
}
