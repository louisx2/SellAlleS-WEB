'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Customer } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomerActions } from './customer-actions';

export const customerColumns: ColumnDef<Customer>[] = [
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
    accessorKey: 'phone',
    header: 'Teléfono',
  },
  {
    accessorKey: 'rnc',
    header: 'RNC / Cédula',
  },
  {
    accessorKey: 'address',
    header: 'Dirección',
  },
  {
    id: 'actions',
    cell: ({ row }) => <CustomerActions customer={row.original} />,
  },
];
