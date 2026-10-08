'use client';

import { useMemo } from 'react';
import type { Product, ProductCategory } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// 'all' = sin filtrar, 'none' = sin categoría, cualquier otro valor = id de la
// categoría. Los ids son uuid, así que no chocan con los dos especiales.
export type CategoryFilterValue = 'all' | 'none' | (string & {});

// Un producto cuya categoría no está en la lista (de otra sucursal que ya no
// se comparte) cuenta como "sin categoría": si no, no saldría en ningún filtro.
export function matchesCategory(
  product: Product,
  filter: CategoryFilterValue,
  knownIds: Set<string>,
): boolean {
  if (filter === 'all') return true;
  const known = !!product.categoryId && knownIds.has(product.categoryId);
  if (filter === 'none') return !known;
  return product.categoryId === filter;
}

interface CategoryFilterSelectProps {
  categories: ProductCategory[];
  // Sobre qué productos se cuentan los números de cada opción.
  products: Product[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
  className?: string;
}

export function CategoryFilterSelect({ categories, products, value, onChange, className }: CategoryFilterSelectProps) {
  const { counts, uncategorized } = useMemo(() => {
    const knownIds = new Set(categories.map((c) => c.id));
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const p of products) {
      if (p.categoryId && knownIds.has(p.categoryId)) {
        counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
      } else {
        uncategorized++;
      }
    }
    return { counts, uncategorized };
  }, [categories, products]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-full sm:w-[220px]'} aria-label="Filtrar por categoría">
        <SelectValue placeholder="Categoría" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas las categorías ({products.length})</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name} ({counts.get(c.id) ?? 0})
          </SelectItem>
        ))}
        {(uncategorized > 0 || value === 'none') && (
          <SelectItem value="none">Sin categoría ({uncategorized})</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
