import type { CartItem, Product, ProductPresentation } from '@/lib/types';
import { ProductImage } from '@/components/products/product-image';
import { ProductDetailButton } from '@/components/products/product-detail-popover';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/cart-provider';
import { cn, formatCurrency } from '@/lib/utils';
import { formatQty, getUnit, roundQty } from '@/lib/units';
import {
  baseQtyInCart, buttonLabel, isSoldLoose, maxAddable, presentationLabel, presentationsOf,
} from '@/lib/presentations';
import { PlusCircle } from 'lucide-react';

interface ProductGridProps {
  products: Product[];
  view: 'list' | 'grid';
}

// Un producto sin inventario (plato preparado, servicio) nunca se agota.
const isSoldOut = (product: Product) => product.tracksStock && product.stock <= 0;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Precio de la tarjeta: el de la unidad. Si el producto no se vende suelto, el de la
// presentación más chica con su etiqueta, para que el precio diga qué se está comprando.
function cardPrice(product: Product, presentations: ProductPresentation[]): { price: number; label?: string } {
  if (isSoldLoose(product) || presentations.length === 0) return { price: product.price };
  const smallest = presentations[0];
  return { price: smallest.price, label: presentationLabel(smallest, getUnit(product.unit).short) };
}

interface AddOption {
  key: string;
  text: string;       // lo que dice el botón: "+ Und", "+ Paq."
  price: number;
  name: string;       // cómo se llama lo que se agrega, para el title y el lector de pantalla
  presentation?: ProductPresentation;
  disabled: boolean;
}

// Un botón por forma de vender: la unidad (solo si se vende suelta) y luego cada
// presentación, de la más chica a la más grande. Se deshabilitan según lo que queda
// una vez descontado lo que ya está en el carrito, en unidades base.
function AddButtons({
  product, items, presentations, onAdd, className, itemClassName,
}: {
  product: Product;
  items: CartItem[];
  presentations: ProductPresentation[];
  onAdd: (product: Product, presentation?: ProductPresentation) => void;
  className?: string;
  // Clases extra de cada botón (el contenedor que lleva el `title`).
  itemClassName?: string;
}) {
  const unit = getUnit(product.unit);
  const remaining = product.tracksStock ? Math.max(0, roundQty(product.stock - baseQtyInCart(product.id, items))) : Infinity;
  const quedan = `Quedan ${formatQty(remaining)} ${unit.short}`;

  const options: AddOption[] = [];
  if (isSoldLoose(product)) {
    options.push({
      key: 'loose',
      text: `+ ${capitalize(unit.short)}`,
      price: product.price,
      name: capitalize(unit.singular),
      // Suelto: basta con que quede algo (en una unidad medible puede ser media libra).
      disabled: maxAddable(product, items, 1) <= 0,
    });
  }
  for (const p of presentations) {
    options.push({
      key: p.id,
      text: `+ ${buttonLabel(p.name)}`,
      price: p.price,
      name: presentationLabel(p, unit.short),
      presentation: p,
      // Una presentación no se parte: tiene que caber entera.
      disabled: maxAddable(product, items, p.units) < 1,
    });
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        // El title va en el contenedor: un botón deshabilitado no recibe el puntero y
        // no mostraría el "Quedan N und".
        // `flex-auto` (base = el ancho del contenido) y un mínimo de 5.5rem: el salto
        // de fila depende de lo que dicen los botones, no de un mínimo fijo. El
        // `min(…, 100%)` evita que, en un contenedor más angosto que 5.5rem, el botón
        // se salga de él.
        <span
          key={o.key}
          className={cn('flex min-w-[min(5.5rem,100%)] flex-auto', itemClassName)}
          title={o.disabled ? quedan : `${o.name} · ${formatCurrency(o.price)}`}
        >
          <Button
            type="button"
            size="sm"
            className="h-auto w-full flex-col gap-0 whitespace-normal px-2 py-1.5 leading-tight"
            onClick={() => onAdd(product, o.presentation)}
            disabled={o.disabled}
            aria-label={`Añadir ${o.name} de ${product.name}`}
          >
            <span className="whitespace-nowrap text-sm font-medium">{o.text}</span>
            {/* Si el precio no cabe, baja de renglón en vez de salirse del botón. */}
            <span className="max-w-full text-center text-[11px] font-normal opacity-90 [overflow-wrap:anywhere]">{formatCurrency(o.price)}</span>
          </Button>
        </span>
      ))}
    </div>
  );
}

export function ProductGrid({ products, view }: ProductGridProps) {
  const { addItem, activeCart } = useCart();
  const items = activeCart?.items ?? [];

  const handleAddToCart = (product: Product, presentation?: ProductPresentation) => {
    if (presentation) addItem(product, 1, presentation);
    else addItem(product);
  };

  if (products.length === 0) {
    return <p className="text-muted-foreground text-center">No se encontraron productos.</p>;
  }

  if (view === 'list') {
    return (
      <div className="space-y-2">
        {products.map((product) => {
          const presentations = presentationsOf(product);
          const hasPresentations = presentations.length > 0;
          const { price, label } = cardPrice(product, presentations);
          return (
           <div key={product.id} className={cn('flex items-center gap-2 p-2 rounded-lg border', hasPresentations && 'flex-wrap')}>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{product.name}</p>
                <p className="text-primary font-bold">
                  {formatCurrency(price)}
                  {label && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{label}</span>}
                </p>
              </div>
              <ProductDetailButton product={product} className="static shadow-none" />
              {hasPresentations ? (
                // En el teléfono los botones bajan a su propia fila; desde sm van en línea.
                <AddButtons
                  product={product}
                  items={items}
                  presentations={presentations}
                  onAdd={handleAddToCart}
                  className="w-full sm:w-auto"
                  // Con `sm:w-auto` el ancho del grupo sale del contenido, y un mínimo en
                  // porcentaje cuenta como 0 en ese cálculo: el grupo quedaría más angosto
                  // que la suma de los mínimos reales y el último botón saltaría de fila.
                  // Un mínimo fijo hace que el ancho calculado y el real coincidan.
                  itemClassName="sm:min-w-[5.5rem]"
                />
              ) : (
                <Button size="icon" onClick={() => handleAddToCart(product)} aria-label="Añadir al carrito" disabled={isSoldOut(product)} title={isSoldOut(product) ? 'Sin existencias' : undefined}>
                   <PlusCircle className="h-4 w-4" />
                </Button>
              )}
           </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {products.map((product) => {
        const presentations = presentationsOf(product);
        const hasPresentations = presentations.length > 0;
        const { price, label } = cardPrice(product, presentations);
        return (
        <Card key={product.id} className="flex flex-col overflow-hidden">
          <CardHeader className="p-0 relative">
            <div className="aspect-square relative w-full">
              <ProductImage image={product.image} alt={product.name} fill variant="thumb" />
            </div>
            <ProductDetailButton product={product} className="absolute top-2 right-2" />
          </CardHeader>
          <CardContent className="p-4 flex-grow">
            <CardTitle className="text-base font-medium leading-tight mb-1">{product.name}</CardTitle>
            <p className="font-bold text-lg text-primary">{formatCurrency(price)}</p>
            {label && <p className="text-xs text-muted-foreground">{label}</p>}
            {isSoldOut(product) && <p className="text-xs text-destructive mt-1">Sin existencias</p>}
          </CardContent>
          <CardFooter className="p-4 pt-0">
            {hasPresentations ? (
              <AddButtons
                product={product}
                items={items}
                presentations={presentations}
                onAdd={handleAddToCart}
                className="w-full"
              />
            ) : (
              <Button
                className="w-full"
                onClick={() => handleAddToCart(product)}
                size="default"
                disabled={isSoldOut(product)}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Añadir
              </Button>
            )}
          </CardFooter>
        </Card>
        );
      })}
    </div>
  );
}
