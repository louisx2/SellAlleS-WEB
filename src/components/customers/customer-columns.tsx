'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Star } from 'lucide-react';
import type { Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { DIAS_ESTRELLA, TOP_ESTRELLAS } from '@/lib/estrellas';
import { CustomerActions } from './customer-actions';

/**
 * Columnas de la lista de clientes. `estrellas` son los ids de los clientes que
 * más compraron últimamente (ver idsClientesEstrella): llevan la estrella junto
 * al nombre.
 */
export function buildCustomerColumns(estrellas: Set<string>): ColumnDef<Customer>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Nombre',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          {row.original.name}
          {estrellas.has(row.original.id) && (
            <span title={`Uno de los ${TOP_ESTRELLAS} clientes que más compraron en los últimos ${DIAS_ESTRELLA} días`}>
              <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-label="Cliente estrella" />
            </span>
          )}
        </span>
      ),
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
      accessorKey: 'discountPercentage',
      header: 'Descuento',
      // El % que el POS le aplica solo al elegirlo en el carrito.
      cell: ({ getValue }) => {
        const pct = getValue<number>() ?? 0;
        return pct > 0 ? <Badge variant="secondary">{pct}%</Badge> : <span className="text-muted-foreground">—</span>;
      },
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
}

export const customerColumns: ColumnDef<Customer>[] = buildCustomerColumns(new Set());
