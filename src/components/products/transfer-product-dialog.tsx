'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';
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
import type { Product } from '@/lib/types';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { useProducts } from '@/context/product-provider';
import { useCanTransfer } from '@/hooks/use-can-transfer';
import {
  formatQuantity, formatQty, getUnit, parseQtyInput, qtyInputRegex, unitAllowsDecimals,
} from '@/lib/units';
import { sendTransfer } from '@/lib/transfers';
import { TransferSlipDialog, formatTransferNumber } from './transfer-slip';

// Valores centinela del desplegable de ubicación. No son ids.
const SIN_UBICACION = '__sin__';
const NUEVA_UBICACION = '__nueva__';

type LocationOption = { id: string; name: string };
type Line = { product: Product; qty: string };

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

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
      .map((p) => ({ product: p, qty: '1' })));
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
    setLines((prev) => [...prev, { product: p, qty: '1' }]);
    setQuery('');
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

  const setQty = (id: string, raw: string) => {
    setLines((prev) => prev.map((l) => {
      if (l.product.id !== id) return l;
      return qtyInputRegex(l.product.unit).test(raw) ? { ...l, qty: raw } : l;
    }));
  };

  const quitar = (id: string) => setLines((prev) => prev.filter((l) => l.product.id !== id));

  // ── Validación ──
  const errorDe = (l: Line): string | null => {
    const q = parseQtyInput(l.qty);
    if (!Number.isFinite(q) || q <= 0) return 'Cantidad inválida';
    if (!unitAllowsDecimals(l.product.unit) && !Number.isInteger(q)) return 'Solo enteros';
    if (q > l.product.stock) return `Solo hay ${formatQty(l.product.stock)}`;
    return null;
  };
  const hayErrores = lines.some((l) => errorDe(l) !== null);
  const quedanEnCero = lines.filter((l) => !errorDe(l) && parseQtyInput(l.qty) === l.product.stock);

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
        items: lines.map((l) => ({ productId: l.product.id, quantity: parseQtyInput(l.qty) })),
        targetLocationId: locationId,
        archiveEmpty,
        notes,
      });

      const destino = branches.find((b) => b.id === targetBranchId)?.name ?? 'la otra sucursal';
      toast({
        title: `Conduce ${formatTransferNumber(result.number)} enviado`,
        description: `${result.items} ${result.items === 1 ? 'artículo' : 'artículos'} a ${destino}.`,
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
                  return (
                    <div key={l.product.id} className="flex items-start gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{l.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.product.code ? `${l.product.code} · ` : ''}hay {formatQuantity(l.product.stock, l.product.unit)}
                        </p>
                      </div>
                      <div className="w-24 shrink-0">
                        <Input
                          inputMode={unitAllowsDecimals(l.product.unit) ? 'decimal' : 'numeric'}
                          value={l.qty}
                          onChange={(e) => setQty(l.product.id, e.target.value)}
                          aria-label={`Cantidad de ${l.product.name}`}
                          className={err ? 'border-destructive' : undefined}
                        />
                        <p className={`mt-0.5 text-[11px] ${err ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {err ?? getUnit(l.product.unit).plural}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => quitar(l.product.id)}
                        aria-label={`Quitar ${l.product.name}`}
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
                  <> Con este envío: {quedanEnCero.map((l) => `«${l.product.name}»`).join(', ')}.</>
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
            Transferir {lines.length > 0 ? `${lines.length} ${lines.length === 1 ? 'artículo' : 'artículos'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
