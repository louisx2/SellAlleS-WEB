'use client';

import { MoreHorizontal, Package, MapPin, Tag, Truck, Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCategories } from '@/context/category-provider';
import { useLocations } from '@/context/location-provider';
import { useSuppliers } from '@/context/supplier-provider';
import type { Product } from '@/lib/types';

interface CartItemDetailButtonProps {
  product: Product;
}

// Detalle de solo-lectura del producto, útil al vender: descripción,
// ubicación, categoría, proveedor y stock. El objeto `product` ya viene
// embebido en el CartItem, así que no hace falta ninguna consulta extra —
// solo resolver los ids a nombre legible con los providers ya cargados.
export function CartItemDetailButton({ product }: CartItemDetailButtonProps) {
  const { categories } = useCategories();
  const { locations } = useLocations();
  const { suppliers } = useSuppliers();

  const categoryName = categories.find((c) => c.id === product.categoryId)?.name;
  const locationName = locations.find((l) => l.id === product.locationId)?.name;
  const supplierName = suppliers.find((s) => s.id === product.supplierId)?.name;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Detalle del producto">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-2">
          <div>
            <p className="font-semibold text-sm leading-tight">{product.name}</p>
            <p className="text-xs text-muted-foreground">Código: {product.code}</p>
          </div>
          <div className="space-y-1.5 text-xs">
            {product.description && (
              <div className="flex items-start gap-1.5">
                <Package className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span>{product.description}</span>
              </div>
            )}
            {locationName && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{locationName}</span>
              </div>
            )}
            {categoryName && (
              <div className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{categoryName}</span>
              </div>
            )}
            {supplierName && (
              <div className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{supplierName}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>Stock disponible: <span className="font-medium">{product.stock}</span></span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
