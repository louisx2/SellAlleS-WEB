'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity, getUnit } from '@/lib/units';
import { breakdownStock, formatBreakdown } from '@/lib/presentations';
import { Badge } from '@/components/ui/badge';
import { ProductActions } from './product-actions';
import { cn } from '@/lib/utils';

// Factoría: el nombre de la categoría sale del provider de categorías (el
// producto solo guarda el id).
export const buildProductColumns = (categoryName: Map<string, string>): ColumnDef<Product>[] => [
  {
    accessorKey: 'name',
    header: 'Nombre',
  },
  {
    accessorKey: 'code',
    header: 'Código',
  },
  {
    id: 'category',
    header: 'Categoría',
    cell: ({ row }) => {
      const id = row.original.categoryId;
      const name = id ? categoryName.get(id) : undefined;
      return name ?? <span className="text-muted-foreground">—</span>;
    },
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
      // Un plato preparado o servicio no lleva existencias: mostrar "0 unidades"
      // en rojo permanente sería ruido.
      if (!row.original.tracksStock) {
        return <span className="text-muted-foreground">No aplica</span>;
      }
      const { unit, presentations } = row.original;
      return (
        <div>
          <span
            className={cn({
              'text-destructive font-bold': stock <= 5,
            })}
          >
            {formatQuantity(stock, unit)}
          </span>
          {/* Con presentaciones, el mismo stock repartido: "4 Caja, 8 Paq., 2 und". */}
          {presentations && presentations.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {formatBreakdown(breakdownStock(stock, presentations), getUnit(unit).short)}
            </div>
          )}
        </div>
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
