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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Product } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/context/product-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useCategories } from '@/context/category-provider';
import { useLocations } from '@/context/location-provider';
import { useState } from 'react';

interface ProductDialogProps {
  product?: Product;
  children: React.ReactNode;
}

export function ProductDialog({ product, children }: ProductDialogProps) {
  const { toast } = useToast();
  const { addProduct, updateProduct } = useProducts();
  const { suppliers } = useSuppliers();
  const { categories } = useCategories();
  const { locations } = useLocations();
  
  const isEditMode = !!product;
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<string>(product?.supplierId || '');
  const [categoryId, setCategoryId] = useState<string>(product?.categoryId || '');
  const [locationId, setLocationId] = useState<string>(product?.locationId || '');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    // We omit 'id' because Firestore/Supabase will generate it for new documents.
    const productData: Omit<Product, 'id'> = {
      code: formData.get('code') as string,
      categoryId: (categoryId && categoryId !== 'none') ? categoryId : undefined,
      name: formData.get('name') as string,
      description: formData.get('description') as string || undefined,
      supplierId: (supplierId && supplierId !== 'none') ? supplierId : undefined,
      price: parseFloat(formData.get('price') as string),
      cost: parseFloat(formData.get('cost') as string),
      itbis: formData.get('itbis') === 'on',
      stock: parseInt(formData.get('stock') as string, 10),
      locationId: (locationId && locationId !== 'none') ? locationId : undefined,
      wholesalePrice: formData.get('wholesalePrice') ? parseFloat(formData.get('wholesalePrice') as string) : undefined,
      wholesaleMinQuantity: formData.get('wholesaleMinQuantity') ? parseInt(formData.get('wholesaleMinQuantity') as string, 10) : undefined,
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Producto' : 'Añadir Producto'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del producto.' : 'Añade un nuevo producto al catálogo.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Código</Label>
              <Input id="code" name="code" defaultValue={product?.code} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="categoryId">Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="categoryId">
                  <SelectValue placeholder="Seleccione una categoría..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguna / Sin asignar</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" defaultValue={product?.name} required />
            </div>
            
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea id="description" name="description" defaultValue={product?.description} rows={2} />
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="supplierId">Proveedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un proveedor..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno / Sin asignar</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cost">Precio Compra (Costo)</Label>
              <Input id="cost" name="cost" type="number" step="0.01" defaultValue={product?.cost} required/>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="price">Precio Venta</Label>
              <Input id="price" name="price" type="number" step="0.01" defaultValue={product?.price} required/>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="stock">Existencias</Label>
              <Input id="stock" name="stock" type="number" defaultValue={product?.stock} required />
            </div>
            <div className="flex flex-col justify-center gap-2">
              <Label htmlFor="itbis" className="mb-1">ITBIS</Label>
              <div className="flex items-center space-x-2 h-10">
                <Checkbox id="itbis" name="itbis" defaultChecked={product?.itbis} />
                <label htmlFor="itbis" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Aplica ITBIS
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="locationId">Ubicación</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="locationId">
                  <SelectValue placeholder="Seleccione una ubicación..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguna / Sin asignar</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="wholesalePrice">Precio Mayoreo</Label>
              <Input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" defaultValue={product?.wholesalePrice} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wholesaleMinQuantity">Cant. Mín. Mayor.</Label>
              <Input id="wholesaleMinQuantity" name="wholesaleMinQuantity" type="number" defaultValue={product?.wholesaleMinQuantity} />
            </div>
          </div>
          
          <DialogFooter className="mt-4">
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
