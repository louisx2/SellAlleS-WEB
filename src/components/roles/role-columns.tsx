'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Role } from '@/lib/types';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Pencil, Trash2 } from 'lucide-react';

interface RoleColumnsActions {
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
  isSuperAdmin?: boolean;
}

export function getRoleColumns({ onEdit, onDelete, isSuperAdmin }: RoleColumnsActions): ColumnDef<Role>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Nombre',
    },
    {
      accessorKey: 'description',
      header: 'Descripción',
    },
    {
      id: 'type',
      header: 'Tipo',
      cell: ({ row }) => (
        row.original.isSystem
          ? <Badge variant="outline">Sistema</Badge>
          : <Badge variant="secondary">Personalizado</Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(row.original)} title={row.original.isSystem && !isSuperAdmin ? 'Ver permisos' : 'Editar'}>
            <Pencil className="h-4 w-4" />
          </Button>
          {!row.original.isSystem && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(row.original)} title="Eliminar">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];
}
