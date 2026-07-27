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
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Product } from '@/lib/types';
import {
  UNITS, DEFAULT_UNIT_CODE, getUnit, unitAllowsDecimals, normalizeQty,
  normalizeUnitCode, parseQtyInput, formatQty, type UnitCode,
} from '@/lib/units';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/context/product-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useCategories } from '@/context/category-provider';
import { useLocations } from '@/context/location-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { ProductImage } from '@/components/products/product-image';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';

interface ProductDialogProps {
  product?: Product;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProductDialog({ product, children, open: openProp, onOpenChange: onOpenChangeProp }: ProductDialogProps) {
  const { toast } = useToast();
  const { addProduct, updateProduct } = useProducts();
  const { suppliers } = useSuppliers();
  const { categories } = useCategories();
  const { locations } = useLocations();
  const { appUser } = useAuth();

  const isEditMode = !!product;
  // Soporta uso como wrapper con trigger propio (children) o como diálogo
  // controlado desde fuera (open/onOpenChange), p. ej. desde un menú de acciones.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChangeProp ?? setUncontrolledOpen;
  const [supplierId, setSupplierId] = useState<string>(product?.supplierId || '');
  const [categoryId, setCategoryId] = useState<string>(product?.categoryId || '');
  const [locationId, setLocationId] = useState<string>(product?.locationId || '');

  // La unidad decide si el producto admite cantidades fraccionadas, así que
  // existencias y cantidad mínima de mayoreo son controladas: su `step` cambia
  // con la unidad y un type="number" con 1.7 y step=1 queda inválido y bloquea
  // el submit con un mensaje nativo que no explica nada.
  const [unit, setUnit] = useState<UnitCode>(product?.unit ?? DEFAULT_UNIT_CODE);
  const [stockInput, setStockInput] = useState<string>(product ? formatQty(product.stock) : '');
  const [minQtyInput, setMinQtyInput] = useState<string>(
    product?.wholesaleMinQuantity != null ? formatQty(product.wholesaleMinQuantity) : ''
  );
  const allowsDecimals = unitAllowsDecimals(unit);
  // Platos preparados, servicios y tarifas: se venden siempre y no llevan
  // existencias, así que el formulario esconde stock, unidad y mayoreo.
  const [tracksStock, setTracksStock] = useState(product?.tracksStock ?? true);

  const handleUnitChange = (next: string) => {
    const nextUnit = normalizeUnitCode(next);
    setUnit(nextUnit);
    if (unitAllowsDecimals(nextUnit)) return;
    // Al pasar a una unidad contable no puede quedar stock fraccionado.
    const stockValue = parseQtyInput(stockInput);
    const minQtyValue = parseQtyInput(minQtyInput);
    const fixes: string[] = [];
    if (Number.isFinite(stockValue) && !Number.isInteger(stockValue)) {
      setStockInput(String(Math.round(stockValue)));
      fixes.push(`existencias a ${Math.round(stockValue)}`);
    }
    if (Number.isFinite(minQtyValue) && !Number.isInteger(minQtyValue)) {
      setMinQtyInput(String(Math.round(minQtyValue)));
      fixes.push(`cant. mín. mayoreo a ${Math.round(minQtyValue)}`);
    }
    if (fixes.length) {
      toast({
        title: `«${getUnit(nextUnit).plural}» no admite decimales`,
        description: `Se redondeó ${fixes.join(' y ')}. Revisa antes de guardar.`,
      });
    }
  };

  // Imagen: solo consideramos "real" una URL http/https/data; 'placeholder' o
  // ids de demo cuentan como "sin imagen" en el formulario.
  const initialImage = product?.image && /^(https?:|data:)/i.test(product.image) ? product.image : '';
  const [imageUrl, setImageUrl] = useState<string>(initialImage);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    const companyId = appUser?.impersonatedCompanyId || appUser?.companyId;
    if (!companyId) {
      toast({ title: 'Sin empresa activa', description: 'No se pudo determinar la empresa.', variant: 'destructive' });
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Archivo inválido', description: 'Selecciona una imagen.', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imagen muy grande', description: 'El máximo es 5 MB.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${companyId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      setImageUrl(data.publicUrl);
      toast({ title: 'Imagen subida' });
    } catch (err: any) {
      toast({ title: 'No se pudo subir', description: err?.message ?? 'Error al subir.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    // Nunca parseInt sobre una cantidad: parseInt('1.7') es 1 en silencio.
    const stockValue = parseQtyInput(stockInput);
    const minQtyValue = minQtyInput.trim() === '' ? undefined : parseQtyInput(minQtyInput);
    const unitLabel = getUnit(unit).plural;

    // Un producto sin inventario no pide existencias ni unidad: se guarda en
    // cero y las validaciones de cantidad no aplican.
    if (tracksStock) {
      if (!Number.isFinite(stockValue) || stockValue < 0) {
        toast({ title: 'Existencias inválidas', description: 'Escribe una cantidad válida mayor o igual que cero.', variant: 'destructive' });
        return;
      }
      if (!allowsDecimals && !Number.isInteger(stockValue)) {
        toast({ title: 'Cantidad inválida', description: `«${unitLabel}» solo admite cantidades enteras.`, variant: 'destructive' });
        return;
      }
      if (minQtyValue !== undefined) {
        if (!Number.isFinite(minQtyValue) || minQtyValue < 0) {
          toast({ title: 'Cantidad mínima inválida', description: 'Escribe una cantidad válida o deja el campo vacío.', variant: 'destructive' });
          return;
        }
        if (!allowsDecimals && !Number.isInteger(minQtyValue)) {
          toast({ title: 'Cantidad inválida', description: `«${unitLabel}» solo admite cantidades enteras.`, variant: 'destructive' });
          return;
        }
      }
    }

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
      stock: tracksStock ? normalizeQty(stockValue, unit) : 0,
      unit: tracksStock ? unit : DEFAULT_UNIT_CODE,
      tracksStock,
      locationId: (locationId && locationId !== 'none') ? locationId : undefined,
      wholesalePrice: tracksStock && formData.get('wholesalePrice') ? parseFloat(formData.get('wholesalePrice') as string) : undefined,
      wholesaleMinQuantity: !tracksStock || minQtyValue === undefined ? undefined : normalizeQty(minQtyValue, unit),
      image: imageUrl.trim() || 'placeholder',
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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Editar Producto' : 'Añadir Producto'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Edita los detalles del producto.' : 'Añade un nuevo producto al catálogo.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label>Imagen del producto</Label>
              <div className="flex items-start gap-4">
                <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                  {imageUrl ? (
                    <>
                      <ProductImage image={imageUrl} alt="Vista previa" fill />
                      <button
                        type="button"
                        onClick={() => setImageUrl('')}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                        title="Quitar imagen"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImagePlus className="h-7 w-7" />
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <Input
                    type="url"
                    placeholder="Pega una URL de imagen (https://…)"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                      {uploading ? 'Subiendo…' : 'Subir archivo'}
                    </Button>
                    <span className="text-xs text-muted-foreground">o pega un enlace · máx 5 MB</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
                  />
                </div>
              </div>
            </div>

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

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Maneja existencias</p>
                <p className="text-xs text-muted-foreground">
                  Apágalo para platos preparados, servicios o tarifas: se venden siempre,
                  no descuentan inventario y nunca aparecen agotados.
                </p>
              </div>
              <Switch checked={tracksStock} onCheckedChange={setTracksStock} />
            </div>

            {tracksStock && (
            <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stock">Existencias ({getUnit(unit).short})</Label>
              <Input
                id="stock"
                name="stock"
                type="number"
                min="0"
                step={allowsDecimals ? '0.001' : '1'}
                value={stockInput}
                onChange={(e) => setStockInput(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit">Unidad de medida</Label>
              <Select value={unit} onValueChange={handleUnitChange}>
                <SelectTrigger id="unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Se venden por pieza (solo enteros)</SelectLabel>
                    {UNITS.filter((u) => u.group === 'contable').map((u) => (
                      <SelectItem key={u.code} value={u.code}>{u.singular} ({u.short})</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Se venden por medida (admiten decimales)</SelectLabel>
                    {UNITS.filter((u) => u.group === 'medible').map((u) => (
                      <SelectItem key={u.code} value={u.code}>{u.singular} ({u.short})</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            </>
            )}
            <div className="flex flex-col justify-center gap-2 md:col-span-2">
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

            {tracksStock && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wholesalePrice">Precio Mayoreo</Label>
                  <Input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" defaultValue={product?.wholesalePrice} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wholesaleMinQuantity">Cant. Mín. Mayor. ({getUnit(unit).short})</Label>
                  <Input
                    id="wholesaleMinQuantity"
                    name="wholesaleMinQuantity"
                    type="number"
                    min="0"
                    step={allowsDecimals ? '0.001' : '1'}
                    value={minQtyInput}
                    onChange={(e) => setMinQtyInput(e.target.value)}
                  />
                </div>
              </>
            )}
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
