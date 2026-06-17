'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Role } from '@/lib/types';
import { Button } from '../ui/button';
import { MoreHorizontal } from 'lucide-react';

export const roleColumns: ColumnDef<Role>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'description',
    header: 'Descripción',
  },
  {
    id: 'actions',
    cell: () => (
        <Button variant="ghost" className="h-8 w-8 p-0" disabled>
            <span className="sr-only">Abrir menú</span>
            <MoreHorizontal className="h-4 w-4" />
        </Button>
    ),
  },
];
