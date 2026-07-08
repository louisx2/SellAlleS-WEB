'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Customer } from '@/lib/types';
import { CustomerActions } from './customer-actions';

export const customerColumns: ColumnDef<Customer>[] = [
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
    accessorKey: 'createdAt',
    header: 'Cliente Desde',
    cell: ({ getValue }) => {
      const val = getValue<string>();
      if (!val) return '—';
      return new Date(val).toLocaleDateString('es-DO');
    }
  },
  {
    accessorKey: 'createdByName',
    header: 'Registrado Por',
    cell: ({ getValue }) => getValue<string>() || '—',
  },
  {
    id: 'actions',
    cell: ({ row }) => <CustomerActions customer={row.original} />,
  },
];
