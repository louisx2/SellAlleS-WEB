'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ProductActions } from './product-actions';
import { cn } from '@/lib/utils';

export const productColumns: ColumnDef<Product>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'code',
    header: 'Código',
  },
  {
    accessorKey: 'price',
    header: 'Precio',
    cell: ({ row }) => formatCurrency(row.getValue('price')),
  },
  {
    accessorKey: 'cost',
    header: 'Costo',
    cell: ({ row }) => formatCurrency(row.getValue('cost')),
  },
  {
    accessorKey: 'stock',
    header: 'Inventario',
    cell: ({ row }) => {
      const stock = row.getValue('stock') as number;
      return (
        <span
          className={cn({
            'text-destructive font-bold': stock <= 5,
          })}
        >
          {stock} unidades
        </span>
      );
    },
  },
  {
    accessorKey: 'itbis',
    header: 'ITBIS',
    cell: ({ row }) => (
      <Badge variant={row.getValue('itbis') ? 'default' : 'secondary'}>
        {row.getValue('itbis') ? 'Sí' : 'No'}
      </Badge>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => <ProductActions product={row.original} />,
  },
];
