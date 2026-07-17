import type { Product } from '@/lib/types';
import { ProductImage } from '@/components/products/product-image';
import { ProductDetailButton } from '@/components/products/product-detail-popover';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/cart-provider';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle } from 'lucide-react';

interface ProductGridProps {
  products: Product[];
  view: 'list' | 'grid';
}

export function ProductGrid({ products, view }: ProductGridProps) {
  const { addItem } = useCart();

  const handleAddToCart = (product: Product) => {
    addItem(product);
  };

  if (products.length === 0) {
    return <p className="text-muted-foreground text-center">No se encontraron productos.</p>;
  }

  if (view === 'list') {
    return (
      <div className="space-y-2">
        {products.map((product) => (
           <div key={product.id} className="flex items-center gap-2 p-2 rounded-lg border">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{product.name}</p>
                <p className="text-primary font-bold">{formatCurrency(product.price)}</p>
              </div>
              <ProductDetailButton product={product} className="static shadow-none" />
              <Button size="icon" onClick={() => handleAddToCart(product)} aria-label="Añadir al carrito">
                 <PlusCircle className="h-4 w-4" />
              </Button>
           </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {products.map((product) => (
        <Card key={product.id} className="flex flex-col overflow-hidden">
          <CardHeader className="p-0 relative">
            <div className="aspect-square relative w-full">
              <ProductImage image={product.image} alt={product.name} fill />
            </div>
            <ProductDetailButton product={product} className="absolute top-2 right-2" />
          </CardHeader>
          <CardContent className="p-4 flex-grow">
            <CardTitle className="text-base font-medium leading-tight mb-1">{product.name}</CardTitle>
            <p className="font-bold text-lg text-primary">{formatCurrency(product.price)}</p>
          </CardContent>
          <CardFooter className="p-4 pt-0">
            <Button
              className="w-full"
              onClick={() => handleAddToCart(product)}
              size="default"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
