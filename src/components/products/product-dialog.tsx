'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { Product } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/context/product-provider';
import { useState } from 'react';

interface ProductDialogProps {
  product?: Product;
  children: React.ReactNode;
}

export function ProductDialog({ product, children }: ProductDialogProps) {
  const { toast } = useToast();
  const { addProduct, updateProduct } = useProducts();
  const isEditMode = !!product;
  const [open, setOpen] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    // We omit 'id' because Firestore will generate it for new documents.
    const productData: Omit<Product, 'id'> = {
      name: formData.get('name') as string,
      code: formData.get('code') as string,
      price: parseFloat(formData.get('price') as string),
      cost: parseFloat(formData.get('cost') as string),
      stock: parseInt(formData.get('stock') as string, 10),
      itbis: formData.get('itbis') === 'on',
      image: product?.image ?? 'placeholder',
    };

    try {
      if (isEditMode && product) {
        await updateProduct({ ...productData, id: product.id });
        toast({
          title: `Producto actualizado`,
          description: `El producto '${productData.name}' ha sido actualizado.`,
        });
      } else {
        await addProduct(productData);
        toast({
          title: `Producto añadido`,
          description: `El producto '${productData.name}' ha sido añadido al catálogo.`,
        });
      }
      setOpen(false); // Close the dialog on successful submit
    } catch (error) {
       console.error("Failed to save product: ", error);
       toast({
         title: 'Error al guardar',
         description: 'No se pudo guardar el producto. Inténtalo de nuevo.',
         variant: 'destructive',
       });
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Producto' : 'Añadir Producto'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del producto.' : 'Añade un nuevo producto al catálogo.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nombre
              </Label>
              <Input id="name" name="name" defaultValue={product?.name} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="code" className="text-right">
                Código
              </Label>
              <Input id="code" name="code" defaultValue={product?.code} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="price" className="text-right">
                Precio
              </Label>
              <Input id="price" name="price" type="number" step="0.01" defaultValue={product?.price} className="col-span-3" required/>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="cost" className="text-right">
                Costo
              </Label>
              <Input id="cost" name="cost" type="number" step="0.01" defaultValue={product?.cost} className="col-span-3" required/>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="stock" className="text-right">
                Inventario
              </Label>
              <Input id="stock" name="stock" type="number" defaultValue={product?.stock} className="col-span-3" required />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="itbis" className="text-right">
                ITBIS
              </Label>
              <Checkbox id="itbis" name="itbis" defaultChecked={product?.itbis} />
            </div>
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit">Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
