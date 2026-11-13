import type { ColumnDef } from '@tanstack/react-table';
import type { Supplier } from '@/lib/types';
import { SupplierActions } from './supplier-actions';

export const supplierColumns: ColumnDef<Supplier>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
    // "Buscar por nombre" encuentra también el nombre comercial.
    filterFn: (row, _columnId, valor) => {
      const q = String(valor ?? '').trim().toLowerCase();
      if (!q) return true;
      const { name, tradeName } = row.original;
      return name.toLowerCase().includes(q) || (tradeName ?? '').toLowerCase().includes(q);
    },
    cell: ({ row }) => {
      const { name, tradeName } = row.original;
      const otroNombre = tradeName && tradeName.trim().toLowerCase() !== name.trim().toLowerCase();
      return (
        <div>
          <div>{name}</div>
          {otroNombre && <div className="text-xs text-muted-foreground">{tradeName}</div>}
        </div>
      );
    },
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
