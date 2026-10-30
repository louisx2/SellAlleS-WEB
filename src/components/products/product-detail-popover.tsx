'use client';

import { Info, Package, MapPin, Tag, Truck, Boxes, Layers, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCategories } from '@/context/category-provider';
import { useLocations } from '@/context/location-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { cn, formatCurrency } from '@/lib/utils';
import { formatQuantity, getUnit } from '@/lib/units';
import {
  breakdownStock, formatBreakdown, isSoldLoose, presentationLabel, presentationsOf,
} from '@/lib/presentations';
import type { Product } from '@/lib/types';

interface ProductDetailButtonProps {
  product: Product;
  className?: string;
}

// Detalle de solo-lectura del producto, útil al vender: descripción,
// ubicación, categoría, proveedor y stock. Se resuelven los ids a nombre
// legible con los providers ya cargados, sin ninguna consulta extra.
export function ProductDetailButton({ product, className }: ProductDetailButtonProps) {
  const { categories } = useCategories();
  const { locations } = useLocations();
  const { suppliers } = useSuppliers();

  const categoryName = categories.find((c) => c.id === product.categoryId)?.name;
  const locationName = locations.find((l) => l.id === product.locationId)?.name;
  const supplierName = suppliers.find((s) => s.id === product.supplierId)?.name;

  const hasWholesale = product.wholesalePrice != null && product.wholesalePrice > 0;
  const presentations = presentationsOf(product);
  const unitShort = getUnit(product.unit).short;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary" size="icon"
          className={cn("h-7 w-7 shrink-0 rounded-full shadow", className)}
          onClick={(e) => e.stopPropagation()}
          title="Ver detalle del producto"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end" onClick={(e) => e.stopPropagation()}>
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
              <span>Stock disponible: <span className="font-medium">{formatQuantity(product.stock, product.unit)}</span></span>
            </div>
            {/* Las existencias siempre son unidades base: aquí se leen por caja, paquete y sueltas. */}
            {product.tracksStock && presentations.length > 0 && (
              <p className="pl-5 text-muted-foreground">
                Equivale a {formatBreakdown(breakdownStock(product.stock, presentations), unitShort)}
              </p>
            )}
            {presentations.length > 0 && (
              <div className="flex items-start gap-1.5">
                <Box className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 space-y-0.5">
                  <p className="text-muted-foreground">
                    Presentaciones{!isSoldLoose(product) && ' (no se vende suelto)'}
                  </p>
                  {presentations.map((p) => (
                    <div key={p.id} className="flex items-baseline justify-between gap-2">
                      <span>
                        {presentationLabel(p, unitShort)}
                        {p.code && <span className="text-muted-foreground"> · {p.code}</span>}
                      </span>
                      <span className="font-medium whitespace-nowrap">{formatCurrency(p.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {hasWholesale && (
              <div className="flex items-start gap-1.5">
                <Layers className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span>
                  Precio por mayor: <span className="font-medium">{formatCurrency(product.wholesalePrice!)}</span>
                  {product.wholesaleMinQuantity != null && product.wholesaleMinQuantity > 0 && (
                    <> <span className="text-muted-foreground">(desde {formatQuantity(product.wholesaleMinQuantity, product.unit)})</span></>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
