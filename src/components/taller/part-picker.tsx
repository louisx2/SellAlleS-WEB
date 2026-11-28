'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { rowToProduct } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity } from '@/lib/units';
import type { Product } from '@/lib/types';

const MAX_RESULTADOS = 40;

/** Buscador de piezas o materiales: artículos de la sucursal (de la ubicación de
 *  repuestos si está configurada), sin los artículos de servicio. «Pieza» y
 *  «taller» solo en órdenes de reparación; en las demás se dice «material». */
export function PartPicker({
  branchId, locationId, suggestedCategoryId, onPick, autoFocus, material = false,
}: {
  branchId?: string;
  locationId?: string;
  /** Categoría que sugiere el servicio elegido: filtra de entrada, se puede quitar. */
  suggestedCategoryId?: string;
  onPick: (product: Product) => void;
  autoFocus?: boolean;
  /** La orden no es de reparación: habla de materiales. */
  material?: boolean;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [onlySuggested, setOnlySuggested] = useState(!!suggestedCategoryId);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOnlySuggested(!!suggestedCategoryId); }, [suggestedCategoryId]);

  useEffect(() => {
    if (!branchId) return;
    let query = supabase.from('products').select('*')
      .eq('branch_id', branchId).eq('is_active', true).eq('es_servicio', false)
      .order('name').limit(3000);
    if (locationId) query = query.eq('location_id', locationId);
    query.then(({ data }) => setProducts((data ?? []).map(rowToProduct)));
  }, [branchId, locationId]);

  // Cerrar la lista al hacer clic fuera.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products
      .filter((p) => !onlySuggested || !suggestedCategoryId || p.categoryId === suggestedCategoryId)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (p.code ?? '').toLowerCase().includes(term))
      .slice(0, MAX_RESULTADOS);
  }, [products, q, onlySuggested, suggestedCategoryId]);

  const pick = (p: Product) => {
    onPick(p);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="space-y-2" ref={boxRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0]); }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={material
            ? 'Buscar material (nombre o código)'
            : locationId ? 'Buscar pieza del taller (nombre o código)' : 'Buscar pieza (nombre o código)'}
          className="pl-8"
          aria-label={material ? 'Buscar material' : 'Buscar pieza'}
        />
        {open && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {products.length === 0
                  ? (locationId
                    ? (material ? 'No hay artículos en la ubicación de repuestos.' : 'No hay piezas en la ubicación del taller.')
                    : 'No hay artículos en esta sucursal.')
                  : material ? 'Ningún artículo coincide.' : 'Ninguna pieza coincide.'}
              </p>
            ) : results.map((p) => {
              const agotado = p.tracksStock && p.stock <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={agotado}
                  onClick={() => pick(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {p.code && <span className="block text-xs text-muted-foreground">{p.code}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums">{formatCurrency(p.price)}</span>
                    <span className={`block text-xs ${agotado ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {p.tracksStock ? (agotado ? 'Agotada' : `Quedan ${formatQuantity(p.stock, p.unit)}`) : 'Sin inventario'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {suggestedCategoryId && (
        <div className="flex items-center gap-2">
          <Switch id="solo-sugeridas" checked={onlySuggested} onCheckedChange={setOnlySuggested} />
          <Label htmlFor="solo-sugeridas" className="text-sm font-normal text-muted-foreground">Solo la categoría que sugiere el servicio</Label>
        </div>
      )}
    </div>
  );
}
