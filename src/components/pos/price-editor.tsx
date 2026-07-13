'use client';

import { useState, useEffect } from 'react';
import { useCart, getEffectiveUnitPrice } from '@/context/cart-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import type { CartItem } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '../ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';


interface PriceEditorProps {
  cartItem: CartItem;
}

const quickDiscountPercentages = [5, 10, 15, 25];

export function PriceEditor({ cartItem }: PriceEditorProps) {
  const { setCustomPrice, removeItem, updateQuantity, activeCart } = useCart();
  const { toast } = useToast();
  const [newPrice, setNewPrice] = useState<string | number>('');
  const [newQuantity, setNewQuantity] = useState<string | number>('');
  const [discountPercentage, setDiscountPercentage] = useState<string | number>('');
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();

  const calculateDiscount = (price: number) => {
    const originalPrice = cartItem.product.price;
    if (price >= originalPrice) return 0;
    return ((originalPrice - price) / originalPrice) * 100;
  };

  const applyDiscountPercentage = (percentage: number) => {
    const originalPrice = cartItem.product.price;
    if (percentage > 100 || percentage < 0) {
        toast({ title: 'Porcentaje inválido', description: 'El descuento debe estar entre 0 y 100.', variant: 'destructive' });
        return;
    }
    const discount = originalPrice * (percentage / 100);
    const discountedPrice = originalPrice - discount;
    setNewPrice(discountedPrice.toFixed(2));
    setDiscountPercentage(percentage.toFixed(2).replace(/\.00$/, ''));
  }

  useEffect(() => {
    if (isOpen) {
      const currentPrice = getEffectiveUnitPrice(cartItem, activeCart?.selectedCustomer);
      setNewPrice(currentPrice);
      setNewQuantity(cartItem.quantity);
      const discount = calculateDiscount(currentPrice);
      setDiscountPercentage(discount > 0.01 ? discount.toFixed(2) : '');
    }
  }, [isOpen, cartItem]);

  useEffect(() => {
      const price = Number(newPrice);
      const discount = calculateDiscount(price);
      setDiscountPercentage(discount > 0.01 ? discount.toFixed(2) : '');
  }, [newPrice]);

  const handleApply = () => {
    const priceValue = Number(newPrice);
    if (isNaN(priceValue) || priceValue < 0) {
      toast({
        title: 'Precio inválido',
        description: 'Por favor, introduce un número válido para el precio.',
        variant: 'destructive',
      });
      return;
    }

    const quantityValue = Number(newQuantity);
     if (isNaN(quantityValue) || quantityValue <= 0 || !Number.isInteger(quantityValue)) {
      toast({
        title: 'Cantidad inválida',
        description: 'Por favor, introduce un número entero positivo para la cantidad.',
        variant: 'destructive',
      });
      return;
    }

    // Update quantity
    updateQuantity(cartItem.cartItemId, quantityValue);

    // Update price
    const priceToSet = priceValue === cartItem.product.price ? undefined : priceValue;
    setCustomPrice(cartItem.cartItemId, priceToSet);
    
    setIsOpen(false);
  };
  
  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const decimalRegex = /^\d*(\.\d{0,2})?$/;
    
    if (decimalRegex.test(value) && value.length <= 9) {
      setNewPrice(value);
    }
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const intRegex = /^\d*$/; // Only allow integers
    if (intRegex.test(value) && value.length <= 6) {
      setNewQuantity(value);
    }
  };

  const handleDiscountPercentageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const decimalRegex = /^\d*(\.\d{0,2})?$/;
    if (decimalRegex.test(value) && value.length <= 5) {
      setDiscountPercentage(value);
      applyDiscountPercentage(Number(value) || 0);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  }
  
  const handleDelete = () => {
    removeItem(cartItem.cartItemId);
    setIsOpen(false);
  }

  const editorContent = (
    <div className="grid gap-6 py-4">
        <div className="grid gap-4">
             <div className="grid grid-cols-3 items-center gap-4">
                <Label htmlFor="quantity">Cantidad</Label>
                <Input
                id="quantity"
                value={newQuantity}
                onChange={handleQuantityChange}
                className="col-span-2 h-8"
                onFocus={e => e.target.select()}
                type="text"
                inputMode="numeric"
                />
            </div>
            <div className="grid grid-cols-3 items-center gap-4">
                <Label htmlFor="price">Precio Unitario</Label>
                <Input
                id="price"
                value={newPrice}
                onChange={handlePriceChange}
                className="col-span-2 h-8"
                onFocus={e => e.target.select()}
                type="text"
                inputMode="decimal"
                />
            </div>
        </div>
        
        <Separator />

        <div className="space-y-3">
            <p className="text-sm font-medium">Aplicar Descuento</p>
             <div className="grid grid-cols-3 items-center gap-4">
                <Label htmlFor="discount">Descuento (%)</Label>
                <Input
                    id="discount"
                    value={discountPercentage}
                    onChange={handleDiscountPercentageChange}
                    className="col-span-2 h-8"
                    onFocus={e => e.target.select()}
                    type="text"
                    inputMode="decimal"
                    placeholder="Ej: 10"
                />
            </div>
            <div className="flex flex-wrap gap-2">
                {quickDiscountPercentages.map(perc => (
                    <Button key={perc} size="sm" variant="outline" onClick={() => applyDiscountPercentage(perc)}>
                        {perc}%
                    </Button>
                ))}
            </div>
        </div>

    </div>
  );

  return (
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
          <SheetTrigger asChild>
               <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                  <MoreHorizontal className="h-4 w-4" />
              </Button>
          </SheetTrigger>
          <SheetContent side={isMobile ? 'bottom' : 'right'} className={isMobile ? 'rounded-t-lg' : ''}>
              <SheetHeader className="text-left mb-4">
                  <SheetTitle>Editar: {cartItem.product.name}</SheetTitle>
                  <SheetDescription>
                      Precio Original: {formatCurrency(cartItem.product.price)}. Ajusta la cantidad, el precio o aplica un descuento.
                  </SheetDescription>
              </SheetHeader>
              {editorContent}
               <SheetFooter className="sm:justify-between gap-2 pt-4">
                 <Button variant="destructive" onClick={handleDelete}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                 </Button>
                <div className="flex gap-2">
                    <SheetClose asChild>
                        <Button variant="secondary">Cancelar</Button>
                    </SheetClose>
                    <Button onClick={handleApply}>Aplicar Cambios</Button>
                </div>
            </SheetFooter>
          </SheetContent>
      </Sheet>
  )
}
