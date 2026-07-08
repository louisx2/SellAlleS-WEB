import type { ColumnDef } from '@tanstack/react-table';
import type { Supplier } from '@/lib/types';
import { SupplierActions } from './supplier-actions';

export const supplierColumns: ColumnDef<Supplier>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'rnc',
    header: 'RNC / Cédula',
  },
  {
    accessorKey: 'contactPerson',
    header: 'Contacto',
  },
  {
    accessorKey: 'phone',
    header: 'Teléfono',
  },
  {
    accessorKey: 'email',
    header: 'Email',
  },
  {
    id: 'actions',
    cell: ({ row }) => <SupplierActions supplier={row.original} />,
  },
];
