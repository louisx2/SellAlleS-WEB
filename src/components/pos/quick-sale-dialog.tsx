'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { useCart } from '@/context/cart-provider';
import { useProducts } from '@/context/product-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import {
  QUICK_DEFAULT_NAME,
  filterRecentQuickItems,
  normalizeQuickName,
  validateQuickItem,
  type QuickItemInput,
  type RecentQuickItem,
} from '@/lib/quick-sales';
import { Zap, Loader2, Delete } from 'lucide-react';

interface QuickSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type QuickTab = 'item' | 'amount';

// Dinero: solo dígitos y hasta dos decimales. Se filtra al teclear (como el
// campo de cantidad del carrito) para que el punto flotante no meta centavos
// de más en el total. El caso "vacío" o "solo un punto" lo atrapa la validación.
const MONEY_RE = /^\d*\.?\d{0,2}$/;
// La cantidad sí deja teclear el punto: así "1.5" llega a `validateQuickItem`,
// que explica que debe ser entera, en vez de comerse la tecla en silencio.
const QTY_RE = /^\d*\.?\d*$/;

const KEYPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'] as const;

// Un campo de dinero vacío no es 0: es "falta el precio" (NaN → 'Escribe un
// precio válido.'). El costo, en cambio, es opcional: vacío = sin costo.
const parseMoney = (raw: string) => (raw.trim() === '' ? NaN : Number(raw));

// Vende en el POS algo que no está en el inventario: un artículo con
// descripción o un monto libre. No toca stock; "Guardar también en inventario"
// es la salida para el que sí se va a repetir.
export function QuickSaleDialog({ open, onOpenChange }: QuickSaleDialogProps) {
  const { toast } = useToast();
  const { addQuickItem, addItem } = useCart();
  const { addProduct } = useProducts();
  const { appUser } = useAuth();
  const { profile } = useCompanyProfile();
  const canCreateProduct = usePermission('products', 'create');
  const activeBranchId = appUser?.activeBranchId;

  const [tab, setTab] = useState<QuickTab>('item');
  const [error, setError] = useState<string | null>(null);

  // Pestaña Artículo
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [itbis, setItbis] = useState(profile.isFormalized);
  const [cost, setCost] = useState('');
  const [saveToInventory, setSaveToInventory] = useState(false);
  // Tras tocar una sugerencia se esconde la lista hasta que se vuelva a escribir:
  // si no, seguiría mostrando el artículo que acaba de llenar el formulario.
  const [hideSuggestions, setHideSuggestions] = useState(false);
  const [recents, setRecents] = useState<RecentQuickItem[]>([]);

  // Pestaña Monto
  const [amount, setAmount] = useState('');
  const [amountName, setAmountName] = useState(QUICK_DEFAULT_NAME);
  const [amountItbis, setAmountItbis] = useState(profile.isFormalized);

  const [saving, setSaving] = useState(false);
  // El estado `saving` deshabilita el botón, pero se aplica en el siguiente
  // render; esta marca se levanta en el mismo instante y garantiza que un
  // doble clic (o Enter + clic) no cree dos productos en el inventario.
  const savingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Cada apertura empieza limpia y con una sola consulta de recientes. Solo
  // depende de `open`: si el perfil de la empresa termina de cargar con el
  // diálogo abierto, no debe borrar lo que el cajero ya escribió.
  useEffect(() => {
    if (!open) return;
    setTab('item');
    setError(null);
    setName('');
    setPrice('');
    setQuantity('1');
    setItbis(profile.isFormalized);
    setCost('');
    setSaveToInventory(false);
    setHideSuggestions(false);
    setRecents([]);
    setAmount('');
    setAmountName(QUICK_DEFAULT_NAME);
    setAmountItbis(profile.isFormalized);

    // Las sugerencias son una ayuda: si no hay sucursal o la consulta falla,
    // el diálogo funciona igual, sin avisar.
    if (!activeBranchId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('articulos_rapidos_recientes', {
          p_branch_id: activeBranchId,
        });
        if (cancelled || rpcError || !Array.isArray(data)) return;
        setRecents(data.map((row: any): RecentQuickItem => ({
          name: String(row.name),
          price: Number(row.price),
          cost: row.cost == null ? null : Number(row.cost),
          itbis: !!row.itbis,
          lastSoldAt: String(row.last_sold_at),
        })));
      } catch {
        // Sin sugerencias.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const suggestions = useMemo(
    () => (hideSuggestions ? [] : filterRecentQuickItems(recents, name)),
    [recents, name, hideSuggestions],
  );

  const pickSuggestion = (item: RecentQuickItem) => {
    setName(item.name);
    setPrice(String(item.price));
    setCost(item.cost == null ? '' : String(item.cost));
    setItbis(item.itbis);
    setHideSuggestions(true);
    setError(null);
  };

  // Mientras se guarda en el inventario no se deja cerrar: la creación ya está
  // en vuelo y, al terminar, el producto igual entra al carrito.
  const handleOpenChange = (next: boolean) => {
    if (!next && saving) return;
    onOpenChange(next);
  };

  const addFromItemTab = async () => {
    const input: QuickItemInput = {
      name,
      price: parseMoney(price),
      quantity: Number(quantity),
      itbis,
      cost: cost.trim() === '' ? undefined : Number(cost),
    };
    const problem = validateQuickItem(input);
    if (problem) { setError(problem); return; }
    setError(null);

    if (!(canCreateProduct && saveToInventory)) {
      addQuickItem(input);
      onOpenChange(false);
      return;
    }

    // Se crea el producto con la cantidad que se vende como existencia y se
    // agrega al carrito como producto normal: al cobrar queda en 0, y si la
    // venta se anula, la existencia vuelve.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const product = await addProduct({
        code: '',
        name: input.name.trim(),
        price: input.price,
        cost: input.cost ?? 0,
        itbis: input.itbis,
        image: 'placeholder',
        stock: input.quantity,
        unit: 'und',
        tracksStock: true,
      });
      addItem(product, input.quantity);
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'No se pudo guardar en el inventario',
        description: e?.message ?? 'Error de conexión.',
        variant: 'destructive',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const addFromAmountTab = () => {
    const input: QuickItemInput = {
      // Descripción vacía no es un error aquí: es "Varios".
      name: amountName.trim() === '' ? QUICK_DEFAULT_NAME : amountName,
      price: parseMoney(amount),
      quantity: 1,
      itbis: amountItbis,
    };
    const problem = validateQuickItem(input);
    if (problem) { setError(problem); return; }
    addQuickItem(input);
    onOpenChange(false);
  };

  const handleAdd = () => {
    // `!open`: el diálogo tarda unos instantes en desaparecer tras agregar; un
    // segundo clic o Enter en ese lapso no debe sumar la línea otra vez.
    if (!open || saving) return;
    if (tab === 'item') void addFromItemTab();
    else addFromAmountTab();
  };

  const addOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleAdd();
  };

  // Teclado en pantalla de la pestaña Monto, para quien cobra con el dedo.
  const pressKey = (key: (typeof KEYPAD)[number]) => {
    setError(null);
    setAmount((prev) => {
      if (key === 'back') return prev.slice(0, -1);
      if (key === '.' && prev === '') return '0.';
      // "0" + dígito reemplaza el cero en vez de acumular "007".
      const next = prev === '0' && key !== '.' ? key : prev + key;
      return MONEY_RE.test(next) ? next : prev;
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => {
          // Que el cursor quede en la descripción y no en la pestaña.
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" /> Venta rápida
          </DialogTitle>
          <DialogDescription>
            Vende algo que no está en el inventario. No descuenta existencias.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as QuickTab); setError(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="item">Artículo</TabsTrigger>
            <TabsTrigger value="amount">Monto</TabsTrigger>
          </TabsList>

          <TabsContent value="item" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="quick-name">Descripción</Label>
              <Input
                id="quick-name"
                ref={nameRef}
                autoComplete="off"
                // Además del foco al abrir: si el diálogo reabre en la pestaña
                // Monto y vuelve a Artículo al reiniciarse, este campo nace después.
                autoFocus
                placeholder="Ej: Reparación de pantalla"
                value={name}
                onChange={(e) => { setName(e.target.value); setHideSuggestions(false); setError(null); }}
                onKeyDown={addOnEnter}
              />
              {suggestions.length > 0 && (
                <div className="rounded-md border bg-card">
                  <p className="px-3 pt-2 text-xs text-muted-foreground">Vendidos antes</p>
                  <ul className="p-1">
                    {suggestions.map((s) => (
                      <li key={normalizeQuickName(s.name)}>
                        <button
                          type="button"
                          onClick={() => pickSuggestion(s)}
                          className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                          <span className="truncate">{s.name}</span>
                          <span className="shrink-0 text-muted-foreground">{formatCurrency(s.price)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="quick-price">Precio</Label>
                <Input
                  id="quick-price"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => {
                    if (MONEY_RE.test(e.target.value)) { setPrice(e.target.value); setError(null); }
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={addOnEnter}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-quantity">Cantidad</Label>
                <Input
                  id="quick-quantity"
                  type="text"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => {
                    if (QTY_RE.test(e.target.value)) { setQuantity(e.target.value); setError(null); }
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={addOnEnter}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-cost">Costo (opcional)</Label>
              <Input
                id="quick-cost"
                type="text"
                inputMode="decimal"
                placeholder="Lo que te costó, por unidad"
                value={cost}
                onChange={(e) => {
                  if (MONEY_RE.test(e.target.value)) { setCost(e.target.value); setError(null); }
                }}
                onFocus={(e) => e.target.select()}
                onKeyDown={addOnEnter}
              />
              <p className="text-xs text-muted-foreground">
                Sirve para calcular la ganancia. Sin costo, la venta queda fuera de ese cálculo.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="quick-itbis" className="cursor-pointer">Lleva ITBIS</Label>
              <Switch id="quick-itbis" checked={itbis} onCheckedChange={setItbis} />
            </div>

            {canCreateProduct && (
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="quick-save-inventory"
                  className="mt-0.5"
                  checked={saveToInventory}
                  onCheckedChange={(v) => setSaveToInventory(v === true)}
                  disabled={saving}
                />
                <div className="space-y-1">
                  <Label htmlFor="quick-save-inventory" className="cursor-pointer">
                    Guardar también en inventario
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Crea el producto con esta cantidad en existencia y lo vende desde el inventario.
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="amount" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="quick-amount-name">Descripción</Label>
              <Input
                id="quick-amount-name"
                autoComplete="off"
                placeholder={QUICK_DEFAULT_NAME}
                value={amountName}
                onChange={(e) => setAmountName(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={addOnEnter}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-amount">Monto</Label>
              <Input
                id="quick-amount"
                type="text"
                // Con teclado en pantalla propio, el del sistema solo estorba.
                // El teclado físico escribe aquí igual.
                inputMode="none"
                autoComplete="off"
                autoFocus
                placeholder="0.00"
                className="h-16 text-right text-3xl font-semibold"
                value={amount}
                onChange={(e) => {
                  if (MONEY_RE.test(e.target.value)) { setAmount(e.target.value); setError(null); }
                }}
                onKeyDown={addOnEnter}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {KEYPAD.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  className="h-14 text-xl"
                  // Sin foco en la tecla: el Enter que sigue debe agregar desde
                  // el campo, no volver a pulsar el último dígito.
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pressKey(key)}
                >
                  {key === 'back'
                    ? <><Delete className="h-5 w-5" /><span className="sr-only">Borrar</span></>
                    : key}
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="quick-amount-itbis" className="cursor-pointer">Lleva ITBIS</Label>
              <Switch id="quick-amount-itbis" checked={amountItbis} onCheckedChange={setAmountItbis} />
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <p className="text-xs text-destructive" role="alert">{error}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleAdd} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
