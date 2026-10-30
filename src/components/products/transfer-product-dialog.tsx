'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { CartItem, Product, ProductPresentation } from '@/lib/types';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { useProducts } from '@/context/product-provider';
import { useCanTransfer } from '@/hooks/use-can-transfer';
import {
  formatQuantity, formatQty, getUnit, parseQtyInput, qtyInputRegex, roundQty, unitAllowsDecimals,
} from '@/lib/units';
import {
  isSoldLoose, lineBaseQty, maxAddable, presentationLabel, presentationsOf, toLinePresentation,
} from '@/lib/presentations';
import { sendTransfer } from '@/lib/transfers';
import { TransferSlipDialog, formatTransferNumber } from './transfer-slip';

// Valores centinela del desplegable de ubicación y del de presentación. No son ids.
const SIN_UBICACION = '__sin__';
const NUEVA_UBICACION = '__nueva__';
const SUELTO = '__suelto__';

type LocationOption = { id: string; name: string };
// `presentationId` null = suelto. Un artículo puede ir en varias líneas (1 Caja + 5 und),
// por eso la línea tiene su propia clave y no se identifica por el artículo.
type Line = { key: string; product: Product; presentationId: string | null; qty: string };

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Opciones de un artículo: suelto (null) y cada presentación. Se puede mandar suelto
// aunque no se venda así: es mover existencias, y la base no lo impide.
const optionsOf = (product: Product): (string | null)[] => [
  null,
  ...presentationsOf(product).map((p) => p.id),
];

// Un artículo que no se vende suelto arranca en su presentación más chica que alcance;
// los demás, suelto, como siempre.
const startingPresentationId = (product: Product): string | null => {
  if (isSoldLoose(product)) return null;
  return presentationsOf(product).find((p) => p.units <= product.stock)?.id ?? null;
};

let lineSeq = 0;
const newLine = (product: Product, presentationId: string | null = startingPresentationId(product)): Line => ({
  key: `l${++lineSeq}`,
  product,
  presentationId,
  qty: '1',
});

// ── Host ────────────────────────────────────────────────────────────────────
// El diálogo vive a nivel de página y no en la fila del inventario: al enviar,
// un artículo que queda en 0 se archiva y su fila desaparece, y con ella se iba
// el conduce que se estaba mostrando.

interface OpenTransferOptions {
  products?: Product[];
  toBranchId?: string;
}

const TransferDialogContext = createContext<((opts?: OpenTransferOptions) => void) | null>(null);

/** Abre el envío. null fuera de un TransferDialogHost o sin permiso. */
export const useOpenTransfer = () => useContext(TransferDialogContext);

export function TransferDialogHost({ children, onSent }: { children: ReactNode; onSent?: (batchId: string) => void }) {
  const canTransfer = useCanTransfer();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<OpenTransferOptions>({});
  const [slipBatchId, setSlipBatchId] = useState<string | null>(null);

  const openTransfer = useCallback((opts: OpenTransferOptions = {}) => {
    setInitial(opts);
    // Diferido: si se abre desde un menú desplegable, el menú tiene que
    // terminar de cerrarse o se lleva el foco (y el diálogo) con él.
    setTimeout(() => setOpen(true), 0);
  }, []);

  return (
    <TransferDialogContext.Provider value={canTransfer ? openTransfer : null}>
      {children}
      {canTransfer && (
        <TransferProductDialog
          open={open}
          onOpenChange={setOpen}
          initialProducts={initial.products}
          initialTargetBranchId={initial.toBranchId}
          onSent={(batchId) => { setSlipBatchId(batchId); onSent?.(batchId); }}
        />
      )}
      <TransferSlipDialog
        batchId={slipBatchId}
        open={!!slipBatchId}
        onOpenChange={(o) => { if (!o) setSlipBatchId(null); }}
      />
    </TransferDialogContext.Provider>
  );
}

// ── Diálogo ─────────────────────────────────────────────────────────────────

interface TransferProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Artículos con los que arranca el envío (p. ej. el de la fila del inventario). */
  initialProducts?: Product[];
  initialTargetBranchId?: string;
  onSent?: (batchId: string) => void;
}

export function TransferProductDialog({
  open, onOpenChange, initialProducts, initialTargetBranchId, onSent,
}: TransferProductDialogProps) {
  const { toast } = useToast();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const { products, reload } = useProducts();
  const activeBranchId = appUser?.activeBranchId;
  const originName = branches.find((b) => b.id === activeBranchId)?.name ?? appUser?.branch ?? 'esta sucursal';

  const [lines, setLines] = useState<Line[]>([]);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [locationChoice, setLocationChoice] = useState(SIN_UBICACION);
  const [nuevaUbicacion, setNuevaUbicacion] = useState('');
  const [archiveEmpty, setArchiveEmpty] = useState(true);
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableBranches = branches.filter((b) => b.id !== activeBranchId && b.isActive !== false);

  // Cada vez que se abre, se arma desde cero con lo que se pidió.
  useEffect(() => {
    if (!open) return;
    setLines((initialProducts ?? [])
      .filter((p) => p.tracksStock && p.stock > 0)
      .map((p) => newLine(p)));
    setTargetBranchId(
      initialTargetBranchId && availableBranches.some((b) => b.id === initialTargetBranchId)
        ? initialTargetBranchId
        : availableBranches.length === 1 ? availableBranches[0].id : '',
    );
    setLocationChoice(SIN_UBICACION);
    setNuevaUbicacion('');
    setArchiveEmpty(true);
    setNotes('');
    setQuery('');
    // Solo al abrir: availableBranches se recalcula en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProducts, initialTargetBranchId]);

  // Las ubicaciones son de la sucursal destino, no de la mía. Solo se ofrecen
  // si quien envía tiene acceso a esa sucursal (el admin lo tiene a todas): la
  // RLS de product_locations no deja ver ni crear las de una sucursal ajena, y
  // en ese caso la ubicación la pone quien recibe.
  const canPickLocation = !!targetBranchId &&
    (appUser?.role === 'admin' || !!appUser?.branches?.some((b) => b.id === targetBranchId));

  useEffect(() => {
    setLocationChoice(SIN_UBICACION);
    setNuevaUbicacion('');
    if (!targetBranchId || !canPickLocation) { setLocations([]); return; }
    let cancelado = false;
    setLoadingLocations(true);
    (async () => {
      const { data } = await supabase
        .from('product_locations')
        .select('id, name')
        .eq('branch_id', targetBranchId)
        .order('name');
      if (!cancelado) {
        setLocations((data ?? []) as LocationOption[]);
        setLoadingLocations(false);
      }
    })();
    return () => { cancelado = true; };
  }, [targetBranchId, canPickLocation]);

  // ── Buscar y agregar artículos ──
  const enLista = useMemo(() => new Set(lines.map((l) => l.product.id)), [lines]);
  const candidatos = useMemo(
    () => products.filter((p) => p.tracksStock && p.stock > 0 && !enLista.has(p.id)),
    [products, enLista],
  );
  const resultados = useMemo(() => {
    const q = normalizar(query);
    if (!q) return [];
    return candidatos
      .filter((p) => normalizar(p.name).includes(q) || normalizar(p.code ?? '').includes(q))
      .slice(0, 8);
  }, [candidatos, query]);

  const agregar = (p: Product) => {
    setLines((prev) => [...prev, newLine(p)]);
    setQuery('');
  };

  // Otra línea del mismo artículo con una presentación que todavía no esté en el envío,
  // pegada a las suyas.
  const agregarOtra = (product: Product) => {
    setLines((prev) => {
      const usadas = prev.filter((l) => l.product.id === product.id).map((l) => l.presentationId);
      const libre = optionsOf(product).find((o) => !usadas.includes(o));
      if (libre === undefined) return prev;
      let ultima = -1;
      prev.forEach((l, i) => { if (l.product.id === product.id) ultima = i; });
      const next = [...prev];
      next.splice(ultima + 1, 0, newLine(product, libre));
      return next;
    });
  };

  // Enter con un lector de códigos: si el código coincide exacto, se agrega.
  const onQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const exacto = candidatos.find((p) => p.code && p.code.trim() === q);
    if (exacto) { agregar(exacto); return; }
    if (resultados.length === 1) agregar(resultados[0]);
  };

  const setQty = (key: string, raw: string) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      // Las presentaciones van enteras aunque la unidad del artículo sea medible.
      const mask = l.presentationId ? qtyInputRegex('und') : qtyInputRegex(l.product.unit);
      return mask.test(raw) ? { ...l, qty: raw } : l;
    }));
  };

  const setPresentation = (key: string, value: string) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      if (value === SUELTO) return { ...l, presentationId: null };
      // 1.5 lb no se vuelve "2 sacos" sola: si la cantidad no es entera, arranca en 1.
      const q = parseQtyInput(l.qty);
      return { ...l, presentationId: value, qty: Number.isInteger(q) && q > 0 ? l.qty : '1' };
    }));
  };

  const quitar = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  // ── Presentaciones y tope por línea ──
  // La presentación que lleva la línea, buscada en las del artículo; undefined = suelta.
  const presentationOf = (l: Line): ProductPresentation | undefined =>
    l.presentationId ? presentationsOf(l.product).find((p) => p.id === l.presentationId) : undefined;

  // La línea como renglón de carrito, para reusar lineBaseQty y maxAddable. Una
  // cantidad vacía o ilegible cuenta 0, así una línea a medio escribir no le quita
  // lugar a las demás.
  const asItem = (l: Line): CartItem => {
    const q = parseQtyInput(l.qty);
    const presentation = presentationOf(l);
    return {
      cartItemId: l.key,
      product: l.product,
      quantity: Number.isFinite(q) && q > 0 ? q : 0,
      presentation: presentation ? toLinePresentation(presentation) : undefined,
    };
  };

  const comparteArticulo = (l: Line) => lines.some((o) => o.key !== l.key && o.product.id === l.product.id);

  // Lo más que cabe en la línea: las existencias menos lo que piden las OTRAS líneas
  // del mismo artículo (todo en unidades base), entre las unidades de la presentación.
  const maxDe = (l: Line): number =>
    maxAddable(
      l.product,
      lines.filter((o) => o.key !== l.key).map(asItem),
      presentationOf(l)?.units ?? 1,
    );

  // ── Validación ──
  const errorDe = (l: Line): string | null => {
    const presentation = presentationOf(l);
    if (l.presentationId && !presentation) return 'Presentación no disponible';
    const q = parseQtyInput(l.qty);
    if (!Number.isFinite(q) || q <= 0) return 'Cantidad inválida';
    if ((presentation || !unitAllowsDecimals(l.product.unit)) && !Number.isInteger(q)) return 'Solo enteros';
    const max = maxDe(l);
    if (q > max) {
      // Suelto y sin otras líneas del artículo: lo de siempre.
      if (!presentation && !comparteArticulo(l)) return `Solo hay ${formatQty(l.product.stock)}`;
      return max > 0 ? `Máximo ${formatQty(max)}` : 'No alcanza';
    }
    return null;
  };
  const hayErrores = lines.some((l) => errorDe(l) !== null);

  // Artículos que se mandan completos: lo de todas sus líneas, en unidades base,
  // suma exactamente sus existencias.
  const quedanEnCero = lines
    .filter((l, i) => lines.findIndex((o) => o.product.id === l.product.id) === i)
    .filter((l) => {
      const suyas = lines.filter((o) => o.product.id === l.product.id);
      if (suyas.some((o) => errorDe(o) !== null)) return false;
      return roundQty(suyas.reduce((acc, o) => acc + lineBaseQty(asItem(o)), 0)) === roundQty(l.product.stock);
    })
    .map((l) => l.product);
  const cuantosArticulos = new Set(lines.map((l) => l.product.id)).size;

  const onSubmit = async () => {
    if (!activeBranchId) return;
    if (!targetBranchId) {
      toast({ title: 'Falta el destino', description: 'Elige a qué sucursal va la mercancía.', variant: 'destructive' });
      return;
    }
    if (lines.length === 0 || hayErrores) {
      toast({ title: 'Revisa el envío', description: 'Agrega al menos un artículo y corrige las cantidades marcadas.', variant: 'destructive' });
      return;
    }
    if (locationChoice === NUEVA_UBICACION && !nuevaUbicacion.trim()) {
      toast({ title: 'Falta la ubicación', description: 'Escribe el nombre de la ubicación nueva.', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      let locationId: string | null = null;
      if (locationChoice === NUEVA_UBICACION) {
        const { data: creada, error: errorUbicacion } = await supabase
          .from('product_locations')
          .insert({ name: nuevaUbicacion.trim(), branch_id: targetBranchId })
          .select('id')
          .single();
        if (errorUbicacion) throw errorUbicacion;
        locationId = creada.id;
      } else if (locationChoice !== SIN_UBICACION) {
        locationId = locationChoice;
      }

      const result = await sendTransfer({
        fromBranchId: activeBranchId,
        toBranchId: targetBranchId,
        items: lines.map((l) => ({
          productId: l.product.id,
          quantity: parseQtyInput(l.qty),
          presentationId: l.presentationId ?? undefined,
        })),
        targetLocationId: locationId,
        archiveEmpty,
        notes,
      });

      const destino = branches.find((b) => b.id === targetBranchId)?.name ?? 'la otra sucursal';
      toast({
        title: `Conduce ${formatTransferNumber(result.number)} enviado`,
        // Los artículos, no las líneas: 1 Caja + 5 sueltas del mismo artículo es uno.
        description: `${cuantosArticulos} ${cuantosArticulos === 1 ? 'artículo' : 'artículos'} a ${destino}.`,
      });
      onOpenChange(false);
      onSent?.(result.batchId);
      await reload();
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'No se pudo transferir',
        description: error?.message || 'Ha ocurrido un error inesperado.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferir a otra sucursal</DialogTitle>
          <DialogDescription>
            Sale de <strong>{originName}</strong> y entra en la sucursal que elijas, en el mismo momento.
            Queda un conduce numerado con todo lo que se mandó.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Sucursal destino</Label>
            <Select value={targetBranchId} onValueChange={setTargetBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona la sucursal" />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableBranches.length === 0 && (
              <p className="text-xs text-muted-foreground">No hay otra sucursal activa a la que enviar.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Artículos</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Busca por nombre o escanea el código"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onQueryKeyDown}
              />
            </div>
            {query.trim() && (
              <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
                {resultados.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">
                    Nada con existencias que coincida en {originName}.
                  </p>
                ) : resultados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregar(p)}
                    className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      {p.code && <span className="block truncate text-xs text-muted-foreground">{p.code}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatQuantity(p.stock, p.unit)}</span>
                  </button>
                ))}
              </div>
            )}

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Todavía no hay artículos en este envío.
              </p>
            ) : (
              <div className="rounded-md border divide-y">
                {lines.map((l) => {
                  const err = errorDe(l);
                  const presentation = presentationOf(l);
                  const unit = getUnit(l.product.unit);
                  const presentations = presentationsOf(l.product);
                  const suyas = lines.filter((o) => o.product.id === l.product.id);
                  const usadaPorOtra = (id: string | null) => suyas.some((o) => o.key !== l.key && o.presentationId === id);
                  const hayLibres = optionsOf(l.product).some((o) => !suyas.some((s) => s.presentationId === o));
                  const esUltima = suyas[suyas.length - 1].key === l.key;
                  const base = lineBaseQty(asItem(l));
                  return (
                    <div key={l.key} className="flex items-start gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{l.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.product.code ? `${l.product.code} · ` : ''}hay {formatQuantity(l.product.stock, l.product.unit)}
                        </p>
                        {presentations.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Select value={l.presentationId ?? SUELTO} onValueChange={(v) => setPresentation(l.key, v)}>
                              <SelectTrigger className="h-8 w-full text-xs sm:w-56" aria-label={`Presentación de ${l.product.name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SUELTO} disabled={usadaPorOtra(null)}>
                                  {capitalize(unit.singular)}
                                </SelectItem>
                                {presentations.map((p) => (
                                  <SelectItem key={p.id} value={p.id} disabled={usadaPorOtra(p.id)}>
                                    {presentationLabel(p, unit.short)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {presentation && base > 0 && (
                              <span className="text-xs text-muted-foreground">= {formatQuantity(base, l.product.unit)}</span>
                            )}
                          </div>
                        )}
                        {presentations.length > 0 && hayLibres && esUltima && (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="mt-0.5 h-auto p-0 text-xs"
                            onClick={() => agregarOtra(l.product)}
                          >
                            <Plus className="mr-1 h-3 w-3" /> Otra presentación de este artículo
                          </Button>
                        )}
                      </div>
                      <div className="w-24 shrink-0">
                        <Input
                          inputMode={presentation || !unitAllowsDecimals(l.product.unit) ? 'numeric' : 'decimal'}
                          value={l.qty}
                          onChange={(e) => setQty(l.key, e.target.value)}
                          aria-label={`Cantidad de ${l.product.name}${presentation ? ` (${presentation.name})` : ''}`}
                          className={err ? 'border-destructive' : undefined}
                        />
                        <p className={`mt-0.5 text-[11px] ${err ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {err ?? (presentation ? presentation.name : unit.plural)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => quitar(l.key)}
                        aria-label={`Quitar ${l.product.name}${presentation ? ` (${presentation.name})` : ''}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {targetBranchId && (
            canPickLocation ? (
              <div className="space-y-2">
                <Label>¿Dónde va a quedar en esa sucursal?</Label>
                <Select value={locationChoice} onValueChange={setLocationChoice}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingLocations ? 'Cargando…' : 'Elige la ubicación'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_UBICACION}>Sin ubicación</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                    <SelectItem value={NUEVA_UBICACION}>+ Crear una ubicación nueva</SelectItem>
                  </SelectContent>
                </Select>
                {locationChoice === NUEVA_UBICACION && (
                  <Input
                    placeholder="Ej: Estante A / Segunda fila"
                    value={nuevaUbicacion}
                    onChange={(e) => setNuevaUbicacion(e.target.value)}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Se aplica a los artículos que llegan nuevos o sin ubicación allá; los que ya tienen una la conservan.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                La ubicación en la sucursal destino la asigna quien recibe.
              </p>
            )
          )}

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="archivar-en-cero"
              checked={archiveEmpty}
              onCheckedChange={(v) => setArchiveEmpty(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="archivar-en-cero" className="font-normal leading-snug">
                Quitar de {originName} los artículos que queden en 0
              </Label>
              <p className="text-xs text-muted-foreground">
                Se archivan, no se borran: su historial sigue y, si vuelven por transferencia, se reactivan solos.
                {archiveEmpty && quedanEnCero.length > 0 && (
                  <> Con este envío: {quedanEnCero.map((p) => `«${p.name}»`).join(', ')}.</>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nota-envio">Nota (opcional)</Label>
            <Textarea
              id="nota-envio"
              rows={2}
              placeholder="Ej: lo lleva Richard en el carro"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || availableBranches.length === 0 || lines.length === 0}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Transferir {lines.length > 0 ? `${cuantosArticulos} ${cuantosArticulos === 1 ? 'artículo' : 'artículos'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
