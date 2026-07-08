'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useCart } from '@/context/cart-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/utils';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { MinusCircle, PlusCircle, ShoppingCart, Trash2, UserSearch, X, Plus, FileText } from 'lucide-react';
import { CheckoutDialog } from './checkout-dialog';
import { CreateQuoteDialog } from './create-quote-dialog';
import { useModules } from '@/context/modules-provider';
import type { Sale, Customer } from '@/lib/types';
import { ReceiptDialog } from './receipt-dialog';
import { CustomerSearchDialog } from './customer-search-dialog';
import { Badge } from '../ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PriceEditor } from './price-editor';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Skeleton } from '../ui/skeleton';

function CartItemImage({ src, alt, hint }: { src: string, alt: string, hint?: string }) {
    const [imageLoaded, setImageLoaded] = useState(false);
    return (
        <div className="relative h-16 w-16 flex items-center justify-center">
            {!imageLoaded && <Skeleton className="h-16 w-16 rounded-md" />}
            <Image
                src={src}
                alt={alt}
                width={64}
                height={64}
                className={cn("rounded-md object-cover transition-opacity duration-300", imageLoaded ? "opacity-100" : "opacity-0")}
                onLoad={() => setImageLoaded(true)}
                data-ai-hint={hint}
            />
        </div>
    );
}

export function CartDisplay() {
  const { 
    carts, 
    activeCartId, 
    setActiveCart, 
    addCart, 
    removeCart, 
    toast, 
    totalItems, 
    clearCart, 
    subtotal, 
    itbisAmount, 
    total,
    totalDiscount,
    updateQuantity,
    setSelectedCustomer,
    getGenericCustomer 
  } = useCart();
  
  const [isCheckoutOpen, setCheckoutOpen] = useState(false);
  const [isQuoteOpen, setQuoteOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [isCustomerSearchOpen, setCustomerSearchOpen] = useState(false);
  const isMobile = useIsMobile();
  const { isModuleEnabled } = useModules();

  const activeCart = carts.find(cart => cart.id === activeCartId);
  
  const handleSaleComplete = (sale: Sale) => {
    setCompletedSale(sale);
  };
  
  const handleRemoveCustomer = () => {
    setSelectedCustomer(getGenericCustomer());
  };

  return (
    <>
      <Card className="flex flex-col h-full overflow-hidden">
        <CardContent className="flex-grow p-4 flex flex-col overflow-hidden">
           <Tabs value={activeCartId} onValueChange={setActiveCart} className="w-full h-full flex flex-col">
              <div className="flex-shrink-0">
                  <div className="flex justify-between items-center gap-2 min-h-[44px]">
                      {toast && <p className="text-sm text-destructive font-medium">{toast}</p>}
                      <div className="flex items-center gap-2 ml-auto">
                          <TooltipProvider>
                              <TabsList className="h-auto p-1 bg-transparent">
                              {carts.map((cart, index) => (
                                  <TabsTrigger
                                      key={cart.id}
                                      value={cart.id}
                                      className="group p-0 h-9 data-[state=active]:bg-primary/20 data-[state=active]:text-primary relative pr-2"
                                      onClick={(e) => e.target instanceof HTMLButtonElement && e.target.getAttribute('role') === 'tab' && setActiveCart(cart.id) }
                                  >
                                      <div className='flex items-center gap-1.5 pl-2'>
                                          <ShoppingCart className="h-5 w-5" />
                                          <Badge className="h-4 w-4 justify-center p-0 text-xs">{index + 1}</Badge>
                                      </div>
                                      {carts.length > 1 && (
                                         <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <button
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-muted-foreground/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:bg-destructive transition-opacity"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>¿Eliminar Carrito #{index + 1}?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Esta acción no se puede deshacer. Se perderán todos los artículos de este carrito.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => removeCart(cart.id)}>Confirmar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                      )}
                                  </TabsTrigger>
                              ))}
                              </TabsList>
                              <Tooltip>
                                  <TooltipTrigger asChild>
                                      <div>
                                          <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={addCart} disabled={totalItems === 0}>
                                              <Plus className="h-4 w-4" />
                                              <span className="sr-only">Añadir nuevo carrito</span>
                                          </Button>
                                      </div>
                                  </TooltipTrigger>
                                  {totalItems === 0 && (
                                      <TooltipContent>
                                          <p>Añade un producto para crear otro carrito.</p>
                                      </TooltipContent>
                                  )}
                              </Tooltip>
                          </TooltipProvider>
                      </div>
                  </div>
              </div>
              <div className="mt-2 flex-grow overflow-y-auto">
                {carts.map(cart => (
                  <TabsContent key={cart.id} value={cart.id} className="m-0 h-full">
                    <div className="flex flex-col h-full">
                      {/* Customer Info */}
                      <div className="mb-4 p-3 border rounded-lg flex-shrink-0">
                        <div className="flex justify-between items-center">
                          <div className='max-w-[80%]'>
                            <p className="text-sm text-muted-foreground">Cliente</p>
                            <div className="flex items-center gap-1">
                              <p className="font-semibold truncate">{cart.selectedCustomer?.name}</p>
                              {cart.selectedCustomer?.id !== '0' && (
                                <button 
                                  onClick={handleRemoveCustomer} 
                                  className="text-muted-foreground hover:text-destructive p-0.5"
                                  title="Quitar cliente"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setCustomerSearchOpen(true)}
                          >
                            {cart.selectedCustomer?.id !== '0' ? 'Cambiar' : (
                              <>
                                <UserSearch className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">Buscar</span>
                              </>
                            )}
                          </Button>
                        </div>
                        {cart.selectedCustomer?.id !== '0' && cart.selectedCustomer?.creditBalance > 0 && (
                          <Badge variant="destructive" className="mt-2">
                            Deuda: {formatCurrency(cart.selectedCustomer.creditBalance)}
                          </Badge>
                        )}
                      </div>

                      {/* Cart Items */}
                      <ScrollArea className="pr-2 flex-grow h-full">
                        {cart.items.length === 0 ? (
                          <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full">
                            <ShoppingCart className="h-12 w-12 mb-4" />
                            <p>Este carrito está vacío</p>
                            <p className="text-xs">Añade productos para empezar.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {cart.items.map((item) => {
                              const placeholder = PlaceHolderImages.find(p => p.id === item.product.image);
                              const currentPrice = item.customPrice ?? item.product.price;
                              return (
                                <div key={item.cartItemId} className={cn(
                                  "flex items-center gap-4 p-3 rounded-lg",
                                  item.customPrice !== undefined && "bg-yellow-100/50"
                                )}>
                                  <div className="hidden sm:block">
                                    <CartItemImage
                                      src={placeholder?.imageUrl ?? 'https://picsum.photos/seed/item/100/100'}
                                      alt={item.product.name}
                                      hint={placeholder?.imageHint}
                                    />
                                  </div>
                                  <div className="flex-grow space-y-2">
                                    <p className="font-medium text-sm leading-tight">{item.product.name}</p>
                                    <div className="flex items-center gap-2">
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}>
                                        <MinusCircle className="h-4 w-4" />
                                      </Button>
                                      <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}>
                                        <PlusCircle className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <div>
                                      {item.customPrice !== undefined ? (
                                        <div className="block">
                                          <span className="text-xs text-muted-foreground line-through">{formatCurrency(item.product.price)}</span>
                                          <span className="text-xs font-semibold block">{formatCurrency(currentPrice)} c/u</span>
                                        </div>
                                      ) : (
                                        <div className="text-xs font-semibold">{formatCurrency(currentPrice)} c/u</div>
                                      )}
                                      <p className="font-semibold text-base mt-1">{formatCurrency(currentPrice * item.quantity)}</p>
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <PriceEditor cartItem={item} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  </TabsContent>
                ))}
              </div>
           </Tabs>
        </CardContent>
        
        {activeCart && activeCart.items.length > 0 && (
           <CardFooter className="p-4 flex-shrink-0 border-t flex flex-col items-stretch gap-4">
             <div className="w-full space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                    <span>Descuento Total</span>
                    <span>-{formatCurrency(totalDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>ITBIS (18%)</span>
                <span>{formatCurrency(itbisAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg mt-1">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
            <div className="flex w-full items-center gap-2">
                <Button className="w-full" size="lg" onClick={() => setCheckoutOpen(true)}>
                Proceder al Pago
                </Button>
                {isModuleEnabled('quotes') && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-11 w-14" onClick={() => setQuoteOpen(true)}>
                          <FileText className="h-5 w-5" />
                          <span className="sr-only">Guardar Cotización</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Guardar como cotización</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="icon" className="h-11 w-14">
                        <Trash2 className="h-5 w-5" />
                        <span className="sr-only">Limpiar Carrito</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Se eliminarán todos los artículos del carrito actual.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={clearCart}>Confirmar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
            </div>
          </CardFooter>
        )}
      </Card>
      
      <CreateQuoteDialog isOpen={isQuoteOpen} onOpenChange={setQuoteOpen} />

      <CheckoutDialog
        isOpen={isCheckoutOpen}
        onOpenChange={setCheckoutOpen}
        onSaleComplete={handleSaleComplete}
      />
      <ReceiptDialog 
        sale={completedSale} 
        isOpen={!!completedSale} 
        onOpenChange={() => setCompletedSale(null)} 
      />
      <CustomerSearchDialog
        isOpen={isCustomerSearchOpen}
        onOpenChange={setCustomerSearchOpen}
        onCustomerSelected={(customer: Customer) => {
          setSelectedCustomer(customer);
          setCustomerSearchOpen(false);
        }}
      />
    </>
  );
}
