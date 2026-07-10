import type { Product } from '@/lib/types';
import { ProductImage } from '@/components/products/product-image';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/cart-provider';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ProductGridProps {
  products: Product[];
}

export function ProductGrid({ products }: ProductGridProps) {
  const { addItem } = useCart();
  const { toast } = useToast();

  const handleAddToCart = (product: Product) => {
    addItem(product);
    // toast({
    //   title: 'Producto añadido',
    //   description: `${product.name} ha sido añadido al carrito.`,
    // });
  };

  if (products.length === 0) {
    return <p className="text-muted-foreground text-center">No se encontraron productos.</p>;
  }

  return (
    <TooltipProvider>
      {/* Desktop Grid View */}
      <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {products.map((product) => {
          return (
            <Tooltip key={product.id}>
              <TooltipTrigger asChild>
                <Card className="flex flex-col overflow-hidden">
                  <CardHeader className="p-0 hidden sm:block">
                    <div className="aspect-square relative w-full">
                      <ProductImage image={product.image} alt={product.name} fill />
                    </div>
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
              </TooltipTrigger>
              <TooltipContent>
                <p>{product.name}</p> {/* Placeholder for description */}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Mobile List View */}
      <div className="sm:hidden space-y-2">
        {products.map((product) => (
           <div key={product.id} className="flex items-center gap-4 p-2 rounded-lg border">
              <div className="flex-1">
                <p className="font-medium">{product.name}</p>
                <p className="text-primary font-bold">{formatCurrency(product.price)}</p>
              </div>
              <Button size="icon" onClick={() => handleAddToCart(product)} aria-label="Añadir al carrito">
                 <PlusCircle className="h-4 w-4" />
              </Button>
           </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
