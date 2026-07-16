'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { User } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { UserActions } from './user-actions';
import { Badge } from '@/components/ui/badge';

export const userColumns: ColumnDef<User>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    accessorKey: 'emailConfirmedAt',
    header: 'Verificación',
    cell: ({ row }) => {
      const confirmed = !!row.original.emailConfirmedAt;
      return (
        <Badge variant={confirmed ? 'outline' : 'destructive'} className={confirmed ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}>
          {confirmed ? 'Verificado' : 'Pendiente'}
        </Badge>
      );
    }
  },
  {
    accessorKey: 'role',
    header: 'Rol',
    cell: ({ row }) => {
      const role = row.getValue('role') as string;
      return (
        <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
          {role === 'admin' ? 'Administrador' : 'Cajero'}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'branch',
    header: 'Sucursal',
  },
  {
    id: 'actions',
    cell: ({ row }) => <UserActions user={row.original} />,
  },
];
