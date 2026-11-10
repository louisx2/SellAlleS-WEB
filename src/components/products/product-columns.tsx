'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { Product } from '@/lib/types';
import { ITBIS_RATE, formatCurrency } from '@/lib/utils';
import { factorItbis, formatoPorcentaje, gananciaDelPrecio } from '@/lib/margen';
import { formatQuantity, getUnit } from '@/lib/units';
import { breakdownStock, formatBreakdown } from '@/lib/presentations';
import { Badge } from '@/components/ui/badge';
import { ProductActions } from './product-actions';
import { cn } from '@/lib/utils';

// Ganancia por unidad sobre el costo (lib/margen.ts). Con la sucursal en
// precios con ITBIS incluido, el impuesto se saca antes de calcularla.
const gananciaDe = (p: Product, itbisIncluido: boolean) =>
  gananciaDelPrecio(p.cost, p.price, factorItbis(itbisIncluido, !!p.itbis, ITBIS_RATE));

// Factoría: el nombre de la categoría sale del provider de categorías (el
// producto solo guarda el id).
export const buildProductColumns = (
  categoryName: Map<string, string>,
  itbisIncluido = false,
): ColumnDef<Product>[] => [
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
    id: 'ganancia',
    header: 'Ganancia',
    accessorFn: (p) => gananciaDe(p, itbisIncluido)?.monto ?? null,
    cell: ({ row }) => {
      const g = gananciaDe(row.original, itbisIncluido);
      if (!g) return <span className="text-muted-foreground">—</span>;
      const pierde = g.monto < 0;
      return (
        <div className="leading-tight">
          <div className={cn(pierde && 'font-medium text-destructive')}>{formatCurrency(g.monto)}</div>
          <div className={cn('text-xs', pierde ? 'text-destructive' : 'text-muted-foreground')}>
            {formatoPorcentaje(g.porcentaje)}%
          </div>
        </div>
      );
    },
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
