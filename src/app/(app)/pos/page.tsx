'use client';

import { ProductSearch } from '@/components/pos/product-search';
import { CartDisplay } from '@/components/pos/cart-display';
import { CartProvider } from '@/context/cart-provider';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CardFooter } from '@/components/ui/card';
import { useCart } from '@/context/cart-provider';

function MobileCart() {
  const { totalItems } = useCart();
  return (
    <div className="lg:hidden fixed bottom-4 right-4 z-50">
        <Sheet>
            <SheetTrigger asChild>
                <Button size="icon" className="h-16 w-16 rounded-full shadow-lg relative">
                    <ShoppingCart className="h-8 w-8" />
                    {totalItems > 0 && (
                        <Badge 
                            variant="destructive" 
                            className="absolute -top-1 -right-1 rounded-full h-6 w-6 flex items-center justify-center text-sm"
                        >
                            {totalItems}
                        </Badge>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="p-0 rounded-t-lg" hideCloseButton>
                <div className="relative p-4 pt-6 h-[90vh] flex flex-col">
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-muted rounded-full" />
                    <CartDisplay />
                </div>
                 <CardFooter className="p-4 bg-background border-t">
                    <SheetClose asChild>
                        <Button variant="outline" className="w-full">Cerrar</Button>
                    </SheetClose>
                </CardFooter>
            </SheetContent>
        </Sheet>
    </div>
  );
}

function PosPageContent() {
  return (
    <>
      <div className="grid lg:grid-cols-[1fr_420px] h-[calc(100vh-4rem)]">
        {/* Main content area for product search with its own scroll */}
        <main className="overflow-y-auto p-4 sm:p-6 lg:p-8">
          <ProductSearch />
        </main>
        
        {/* Sticky cart sidebar for large screens */}
        <aside className="hidden lg:flex flex-col border-l bg-background p-4 overflow-hidden">
           <CartDisplay />
        </aside>
      </div>
      <MobileCart />
    </>
  );
}


export default function PosPage() {
    return (
      <CartProvider>
          <PosPageContent />
      </CartProvider>
    )
}
