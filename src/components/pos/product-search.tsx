'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { ProductGrid } from './product-grid';
import { useProducts } from '@/context/product-provider';
import { useCart } from '@/context/cart-provider';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Search, SlidersHorizontal, List, LayoutGrid, Camera } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/auth-provider';
import {
  BarcodeScannerDialog,
  puedeEscanearConCamara,
  type ResultadoEscaneo,
} from './barcode-scanner-dialog';

// Preferencia por dispositivo: la caja que tiene el lector fisico deja el modo
// activo, las que se teclean a mano lo apagan.
const SCANNER_MODE_KEY = 'posScannerMode';

export function ProductSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<'name' | 'code'>('name');
  // Por defecto activado, para no cambiarle el comportamiento a quien ya usa lector.
  const [scannerMode, setScannerMode] = useState(true);
  const { products: allProducts } = useProducts();
  const { addItem, saleCompletionCount } = useCart();
  const { toast } = useToast();
  const { appUser, setInventoryView } = useAuth();
  const inventoryView = appUser?.inventoryView ?? 'grid';
  const prevSaleCompletionCount = useRef(saleCompletionCount);
  const [escanerAbierto, setEscanerAbierto] = useState(false);
  // Se resuelve en el cliente: el HTML es estático y en el servidor no hay
  // cámara ni `matchMedia` que valgan.
  const [puedeEscanear, setPuedeEscanear] = useState(false);

  useEffect(() => {
    setPuedeEscanear(puedeEscanearConCamara());
  }, []);

  // Misma búsqueda para el código escrito y para el escaneado, para que el
  // lector de mano y la cámara no encuentren cosas distintas.
  const buscarPorCodigo = useCallback((codigo: string) => {
    const objetivo = codigo.trim().toLowerCase();
    if (!objetivo) return undefined;
    return allProducts.find(p => (p.code ?? '').trim().toLowerCase() === objetivo);
  }, [allProducts]);

  const manejarCodigoEscaneado = useCallback((codigo: string): ResultadoEscaneo => {
    const producto = buscarPorCodigo(codigo);
    if (!producto) return { ok: false, mensaje: `Ningún producto tiene el código ${codigo}` };
    // `addItem` también frena por existencias, pero en silencio: con la cámara
    // en la cara hace falta decir por qué no entró al carrito.
    if (producto.tracksStock && producto.stock <= 0) {
      return { ok: false, mensaje: `${producto.name} no tiene existencias` };
    }
    addItem(producto);
    return { ok: true, mensaje: `${producto.name} agregado` };
  }, [buscarPorCodigo, addItem]);

  const filteredProducts = useMemo(() => {
    // Los productos sin inventario (platos, servicios) siempre están a la venta.
    const productsInStock = allProducts.filter(p => !p.tracksStock || p.stock > 0);
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      // When search is empty, show all products.
      return productsInStock;
    }
    if (searchMode === 'code') {
      // Con el modo lector activo no filtramos la grilla: el codigo escaneado
      // se agrega solo al carrito. Con el modo apagado solo filtramos.
      if (scannerMode) return productsInStock;
      return productsInStock.filter(product =>
        (product.code ?? '').toLowerCase().includes(term)
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

  // El modo lector solo gobierna lo que se teclea: el botón de la cámara es una
  // intención explícita del cajero y agrega al carrito esté como esté.
  useEffect(() => {
    if (scannerMode && searchMode === 'code' && searchTerm.trim() !== '') {
      const product = buscarPorCodigo(searchTerm);
      if (product) {
        addItem(product);
        setSearchTerm(''); // Clear input after adding
      }
    }
  }, [searchTerm, searchMode, scannerMode, buscarPorCodigo, addItem, toast]);

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
