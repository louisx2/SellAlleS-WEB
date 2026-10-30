'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { ProductGrid } from './product-grid';
import { useProducts } from '@/context/product-provider';
import { useCart } from '@/context/cart-provider';
import {
  baseQtyInCart, duplicateCodeMessage, findByCode, isPrefixOfLongerCode, isSellable, isSoldLoose,
  maxAddable, presentationLabel, type CodeMatch, type AmbiguousCode,
} from '@/lib/presentations';
import { formatQuantity, getUnit, roundQty } from '@/lib/units';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Search, SlidersHorizontal, List, LayoutGrid, Camera, Zap } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/auth-provider';
import { useCanQuickSell } from '@/hooks/use-can-quick-sell';
import { QuickSaleDialog } from './quick-sale-dialog';
import {
  BarcodeScannerDialog,
  puedeEscanearConCamara,
  type ResultadoEscaneo,
} from './barcode-scanner-dialog';

// Preferencia por dispositivo: la caja que tiene el lector fisico deja el modo
// activo, las que se teclean a mano lo apagan.
const SCANNER_MODE_KEY = 'posScannerMode';

// Con un código que es el comienzo de otro más largo (GAL-001 y GAL-001-12), el modo
// lector espera a Enter o a que se deje de teclear este tiempo antes de agregar: el
// lector de mano teclea un carácter a la vez y el resto puede venir en camino.
const ESPERA_PREFIJO_MS = 250;

export function ProductSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<'name' | 'code'>('name');
  // Por defecto activado, para no cambiarle el comportamiento a quien ya usa lector.
  const [scannerMode, setScannerMode] = useState(true);
  const { products: allProducts } = useProducts();
  const { addItem, saleCompletionCount, activeCart } = useCart();
  const { toast } = useToast();
  const { appUser, setInventoryView } = useAuth();
  const inventoryView = appUser?.inventoryView ?? 'grid';
  const prevSaleCompletionCount = useRef(saleCompletionCount);
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  // Módulo encendido y permiso en el rol de esta sucursal: sin ambos no hay botón.
  const puedeVentaRapida = useCanQuickSell();
  const [ventaRapidaAbierta, setVentaRapidaAbierta] = useState(false);
  // Se resuelve en el cliente: el HTML es estático y en el servidor no hay
  // cámara ni `matchMedia` que valgan.
  const [puedeEscanear, setPuedeEscanear] = useState(false);

  useEffect(() => {
    setPuedeEscanear(puedeEscanearConCamara());
  }, []);

  // Misma búsqueda para el código escrito y para el escaneado, para que el
  // lector de mano y la cámara no encuentren cosas distintas. Devuelve el producto
  // y, si el código es el de una presentación, cuál.
  const buscarPorCodigo = useCallback((codigo: string) => findByCode(codigo, allProducts), [allProducts]);

  const manejarCodigoEscaneado = useCallback((codigo: string): ResultadoEscaneo => {
    const encontrado = buscarPorCodigo(codigo);
    if (!encontrado) return { ok: false, mensaje: `Ningún producto tiene el código ${codigo}` };
    // Repetido en la sucursal: cualquiera que se agregue puede ser el equivocado.
    if ('ambiguous' in encontrado) return { ok: false, mensaje: duplicateCodeMessage(codigo) };
    const { product: producto, presentation } = encontrado;
    // `addItem` también frena por existencias, pero en silencio: con la cámara
    // en la cara hace falta decir por qué no entró al carrito.
    if (presentation) {
      const items = activeCart?.items ?? [];
      if (maxAddable(producto, items, presentation.units) < 1) {
        const unidad = getUnit(producto.unit);
        const restante = roundQty(producto.stock - baseQtyInCart(producto.id, items));
        return {
          ok: false,
          mensaje: `No alcanza para 1 ${presentationLabel(presentation, unidad.short)} de ${producto.name} (quedan ${formatQuantity(restante, producto.unit)}).`,
        };
      }
      addItem(producto, 1, presentation);
      return { ok: true, mensaje: `${producto.name} · ${presentationLabel(presentation, getUnit(producto.unit).short)} agregado` };
    }
    // El código del producto mismo vende una unidad suelta: si no se vende suelto,
    // no entra nada (el mismo texto que da el carrito y la base).
    if (!isSoldLoose(producto)) return { ok: false, mensaje: `«${producto.name}» no se vende suelto.` };
    if (producto.tracksStock && producto.stock <= 0) {
      return { ok: false, mensaje: `${producto.name} no tiene existencias` };
    }
    addItem(producto);
    return { ok: true, mensaje: `${producto.name} agregado` };
  }, [buscarPorCodigo, addItem, activeCart]);

  const filteredProducts = useMemo(() => {
    // Los productos sin inventario (platos, servicios) siempre están a la venta.
    // `isSellable` cubre además al que no se vende suelto: tiene que alcanzar para
    // la presentación más chica, no basta con que haya una unidad.
    const productsInStock = allProducts.filter(isSellable);
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      // When search is empty, show all products.
      return productsInStock;
    }
    if (searchMode === 'code') {
      // Con el modo lector activo no filtramos la grilla: el codigo escaneado
      // se agrega solo al carrito. Con el modo apagado solo filtramos.
      if (scannerMode) return productsInStock;
      // También por el código de sus presentaciones: quien teclea el de la caja
      // tiene que ver el producto.
      return productsInStock.filter(product =>
        (product.code ?? '').toLowerCase().includes(term)
        || (product.presentations ?? []).some(p => (p.code ?? '').toLowerCase().includes(term))
      );
    }
    return productsInStock.filter(product =>
      product.name.toLowerCase().includes(term)
    );
  }, [searchTerm, allProducts, searchMode, scannerMode]);

  useEffect(() => {
    if (saleCompletionCount > prevSaleCompletionCount.current) {
      setSearchTerm('');
    }
    prevSaleCompletionCount.current = saleCompletionCount;
  }, [saleCompletionCount]);
  
  useEffect(() => {
    try {
      setScannerMode(localStorage.getItem(SCANNER_MODE_KEY) !== 'false');
    } catch {
      // Si el navegador bloquea el almacenamiento, dejamos el valor por defecto.
    }
  }, []);

  const handleScannerModeChange = (enabled: boolean) => {
    setScannerMode(enabled);
    try {
      localStorage.setItem(SCANNER_MODE_KEY, String(enabled));
    } catch {
      // Sin persistencia el cambio igual aplica en esta sesion.
    }
  };

  // Lo tecleado (o escaneado con el lector de mano) ya es un código: con el de una
  // presentación entra esa presentación; el del producto mismo entra suelto (y
  // `addItem` lo rechaza, con aviso, si no se vende suelto). Un código repetido en la
  // sucursal no agrega nada. En los dos casos la caja queda limpia para el siguiente.
  const agregarPorCodigo = useCallback((codigo: string, encontrado: CodeMatch | AmbiguousCode) => {
    if ('ambiguous' in encontrado) {
      toast({ title: 'Código repetido', description: duplicateCodeMessage(codigo), variant: 'destructive' });
    } else {
      addItem(encontrado.product, 1, encontrado.presentation);
    }
    setSearchTerm('');
  }, [addItem, toast]);

  // La espera en curso de un código que es el comienzo de otro más largo: el temporizador,
  // lo tecleado y lo que encontró. Enter solo puede cerrar esta espera.
  const esperaRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    codigo: string;
    encontrado: CodeMatch | AmbiguousCode;
  } | null>(null);

  // El modo lector solo gobierna lo que se teclea: el botón de la cámara es una
  // intención explícita del cajero y agrega al carrito esté como esté. Un código que
  // es el comienzo de otro más largo no se agrega todavía: espera a Enter (abajo) o a
  // que se deje de teclear; cualquier otro entra en cuanto se completa, como siempre.
  useEffect(() => {
    if (!scannerMode || searchMode !== 'code' || searchTerm.trim() === '') return;
    const encontrado = buscarPorCodigo(searchTerm);
    if (!encontrado) return;
    if (!isPrefixOfLongerCode(searchTerm, allProducts)) {
      agregarPorCodigo(searchTerm, encontrado);
      return;
    }
    const espera = {
      codigo: searchTerm,
      encontrado,
      timer: setTimeout(() => {
        esperaRef.current = null;
        agregarPorCodigo(searchTerm, encontrado);
      }, ESPERA_PREFIJO_MS),
    };
    esperaRef.current = espera;
    return () => {
      clearTimeout(espera.timer);
      if (esperaRef.current === espera) esperaRef.current = null;
    };
  }, [searchTerm, searchMode, scannerMode, buscarPorCodigo, allProducts, agregarPorCodigo]);

  // Enter (los lectores lo mandan al final del código) cierra la espera sin aguardar
  // los 250 ms. Sin espera pendiente no hace nada: el código ya entró solo y la caja
  // puede no haberse limpiado todavía en pantalla; volver a buscar ese texto lo
  // agregaría dos veces.
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const espera = esperaRef.current;
    if (!espera) return;
    e.preventDefault();
    clearTimeout(espera.timer);
    esperaRef.current = null;
    agregarPorCodigo(espera.codigo, espera.encontrado);
  };

  const handleModeChange = (mode: 'name' | 'code') => {
    setSearchMode(mode);
    setSearchTerm(''); // Clear search on mode change
  }

  const placeholderText = searchMode === 'name'
    ? "Buscar producto por nombre..."
    : scannerMode
      ? "Escanear o introducir código de barras..."
      : "Buscar producto por código...";

  return (
    <div className="space-y-6 flex flex-col h-full">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-headline text-gray-800">Inventario</h1>
      <div className="flex gap-2">
        <div className="relative flex-grow">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder={placeholderText}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-12 pl-12 text-base sm:text-lg w-full"
              autoFocus
            />
        </div>
        {puedeEscanear && (
            <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setEscanerAbierto(true)}
            >
                <Camera className="h-5 w-5" />
                <span className="sr-only">Escanear con la cámara</span>
            </Button>
        )}
        {puedeVentaRapida && (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-12 w-12 shrink-0"
                            onClick={() => setVentaRapidaAbierta(true)}
                        >
                            <Zap className="h-5 w-5" />
                            <span className="sr-only">Venta rápida</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Venta rápida</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )}
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-12 w-12 shrink-0">
                    <SlidersHorizontal className="h-5 w-5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
                <div className="space-y-2">
                    <p className="text-sm font-medium">Buscar por</p>
                     <RadioGroup
                        value={searchMode}
                        onValueChange={(value) => handleModeChange(value as 'name' | 'code')}
                        className="flex items-center space-x-4"
                        >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="name" id="name" />
                            <Label htmlFor="name">Nombre</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="code" id="code" />
                            <Label htmlFor="code">Código</Label>
                        </div>
                    </RadioGroup>
                    {searchMode === 'code' && (
                      <>
                        <Separator />
                        <div className="flex items-start justify-between gap-4 pt-1">
                            <div className="space-y-1">
                                <Label htmlFor="scanner-mode-switch" className="text-sm font-medium">
                                    Modo lector de código de barras
                                </Label>
                                <p className="text-xs text-muted-foreground max-w-[15rem]">
                                    {scannerMode
                                      ? 'El código escaneado se agrega solo al carrito.'
                                      : 'Solo filtra los productos; tocá el producto para agregarlo.'}
                                </p>
                            </div>
                            <Switch
                                id="scanner-mode-switch"
                                checked={scannerMode}
                                onCheckedChange={handleScannerModeChange}
                            />
                        </div>
                      </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
        <TooltipProvider>
            {/* Un solo botón que alterna. El icono es el DESTINO, no el estado:
                enseña lo que consigues al pulsarlo, y cambia con cada toque. */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-12 w-12 shrink-0"
                        onClick={() => setInventoryView(inventoryView === 'grid' ? 'list' : 'grid')}
                    >
                        {inventoryView === 'grid'
                            ? <List className="h-5 w-5" />
                            : <LayoutGrid className="h-5 w-5" />}
                        <span className="sr-only">
                            {inventoryView === 'grid' ? 'Ver en lista, sin imágenes' : 'Ver con imágenes'}
                        </span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {inventoryView === 'grid' ? 'Ver en lista (sin imágenes)' : 'Ver con imágenes'}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex-grow overflow-y-auto">
        <ProductGrid products={filteredProducts} view={inventoryView} />
      </div>

      {puedeVentaRapida && (
        <QuickSaleDialog open={ventaRapidaAbierta} onOpenChange={setVentaRapidaAbierta} />
      )}

      {puedeEscanear && (
        <BarcodeScannerDialog
          open={escanerAbierto}
          onOpenChange={setEscanerAbierto}
          onCodigo={manejarCodigoEscaneado}
        />
      )}
    </div>
  );
}
