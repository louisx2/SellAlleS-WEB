'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Pencil, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCategories } from '@/context/category-provider';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import type { ServiceType } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';

const NINGUNO = 'none';

// Los diálogos de esta pantalla no usan el Select de Radix (se congela): <select> nativo.
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Comision = 'persona' | 'porcentaje' | 'monto';
type Articulo = { id: string; name: string; price: number };

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: string;
  itbis: boolean;
  equipmentTypeId: string;
  partCategoryId: string;
  warrantyDays: string;
  durationMin: string;
  comision: Comision;
  comisionValor: string;
  repeatEveryDays: string;
  atCustomerDefault: boolean;
  esServicio: boolean;
  /** Artículo existente que se usa como servicio (solo al crear o sin artículo). */
  linkProduct?: Articulo;
  isActive: boolean;
};

const COMISIONES: [Comision, string][] = [
  ['persona', '% de la persona'],
  ['porcentaje', 'Un % de este servicio'],
  ['monto', 'Un monto fijo (RD$)'],
];

export function CatalogTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const { categories } = useCategories();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [usarExistente, setUsarExistente] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Articulo[]>([]);
  // Mientras se lee es_servicio del artículo no se puede guardar (si no, se pisaría con true).
  const [esCargando, setEsCargando] = useState(false);

  const open = (s?: ServiceType) => {
    setUsarExistente(false);
    setBusqueda('');
    setDraft({
      id: s?.id,
      name: s?.name ?? '',
      description: s?.description ?? '',
      price: s ? String(s.price) : '',
      itbis: s?.itbis ?? false,
      equipmentTypeId: s?.equipmentTypeId ?? NINGUNO,
      partCategoryId: s?.partCategoryId ?? NINGUNO,
      warrantyDays: s?.warrantyDays?.toString() ?? '',
      durationMin: s?.durationMin?.toString() ?? '',
      comision: s?.commissionAmount != null ? 'monto' : s?.commissionRate != null ? 'porcentaje' : 'persona',
      comisionValor: (s?.commissionAmount ?? s?.commissionRate)?.toString() ?? '',
      repeatEveryDays: s?.repeatEveryDays?.toString() ?? '',
      atCustomerDefault: s?.atCustomerDefault ?? false,
      esServicio: true,
      isActive: s?.isActive ?? true,
    });
  };

  const close = () => { setDraft(null); setUsarExistente(false); setBusqueda(''); };

  const editingProductId = draft?.id ? config.catalog.find((c) => c.id === draft.id)?.productId : undefined;

  // «Factura como servicio» se lee del artículo del servicio al editar.
  useEffect(() => {
    if (!editingProductId) { setEsCargando(false); return; }
    let vivo = true;
    setEsCargando(true);
    supabase.from('products').select('es_servicio').eq('id', editingProductId).maybeSingle().then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data) {
        toast({ title: 'No se pudo leer si factura como servicio', description: error?.message, variant: 'destructive' });
        return; // sigue bloqueado el guardado: no se pisa el valor
      }
      setDraft((d) => (d?.id ? { ...d, esServicio: data.es_servicio !== false } : d));
      setEsCargando(false);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingProductId]);

  // Buscador de artículos de la sucursal para «Usar un artículo que ya existe».
  useEffect(() => {
    if (!usarExistente || !config.branchId) { setResultados([]); return; }
    const term = busqueda.trim().replace(/[%,()]/g, ' ');
    let q = supabase.from('products').select('id, name, price')
      .eq('branch_id', config.branchId).eq('is_active', true).order('name').limit(8);
    if (term) q = q.ilike('name', `%${term}%`);
    q.then(({ data }) => {
      const usados = new Set(config.catalog.map((c) => c.productId));
      setResultados((data ?? []).filter((r: any) => !usados.has(r.id)).map((r: any) => ({ id: r.id, name: r.name, price: Number(r.price) })));
    });
  }, [usarExistente, busqueda, config.branchId, config.catalog]);

  const save = async () => {
    if (!draft || !config.branchId) return;
    const price = Number(draft.price);
    if (!draft.name.trim()) { toast({ title: 'Escribe el nombre del servicio', variant: 'destructive' }); return; }
    if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      toast({ title: 'Escribe el precio del servicio', variant: 'destructive' }); return;
    }
    const cv = Number(draft.comisionValor);
    if (draft.comision !== 'persona') {
      const mal = draft.comisionValor.trim() === '' || !Number.isFinite(cv) || cv < 0 || (draft.comision === 'porcentaje' && cv > 100);
      if (mal) {
        toast({ title: draft.comision === 'porcentaje' ? 'La comisión va de 0 a 100 %' : 'Escribe el monto de la comisión', variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase.rpc('taller_guardar_servicio', {
      p: {
        id: draft.id ?? null,
        branch_id: config.branchId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: Math.round(price * 100) / 100,
        itbis: draft.itbis,
        equipment_type_id: draft.equipmentTypeId === NINGUNO ? null : draft.equipmentTypeId,
        part_category_id: draft.partCategoryId === NINGUNO ? null : draft.partCategoryId,
        warranty_days: draft.warrantyDays.trim() === '' ? null : Number(draft.warrantyDays),
        is_active: draft.isActive,
        position: draft.id ? undefined : config.catalog.length,
        duration_min: draft.durationMin.trim() === '' ? null : Number(draft.durationMin),
        // Nunca los dos a la vez (lo exige la base).
        commission_rate: draft.comision === 'porcentaje' ? cv : null,
        commission_amount: draft.comision === 'monto' ? cv : null,
        repeat_every_days: draft.repeatEveryDays.trim() === '' ? null : Number(draft.repeatEveryDays),
        at_customer_default: draft.atCustomerDefault,
        es_servicio: draft.esServicio,
        link_product_id: usarExistente ? draft.linkProduct?.id ?? null : null,
      },
    });
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: draft.id ? 'Servicio actualizado' : 'Servicio creado' });
    close();
    config.reload();
  };

  const typeName = (id?: string) => config.equipmentTypes.find((t) => t.id === id)?.name;
  const categoryName = (id?: string) => categories.find((c) => c.id === id)?.name;
  const puedeUsarExistente = !draft?.id || !editingProductId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Catálogo de servicios</CardTitle>
          <CardDescription>
            Lo que cobras: un corte, un baño, una limpieza, un cambio de aceite… Las piezas o
            materiales se agregan en cada orden, con su precio. Cada servicio queda también como
            artículo de servicio en Inventario, así que se cobra en el POS.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" />Nuevo servicio</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {config.catalog.length === 0 && (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no hay servicios en el catálogo de esta sucursal.
          </p>
        )}
        {config.catalog.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {!s.isActive && <Badge variant="outline">Inactivo</Badge>}
                {!s.productId && <Badge variant="destructive">Guárdalo para activarlo</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(s.price)}{s.itbis ? ' + ITBIS' : ''}
                {typeName(s.equipmentTypeId) ? ` · ${typeName(s.equipmentTypeId)}` : ''}
                {categoryName(s.partCategoryId) ? ` · piezas: ${categoryName(s.partCategoryId)}` : ''}
                {s.durationMin ? ` · ${s.durationMin} min` : ''}
                {s.commissionAmount != null
                  ? ` · comisión ${formatCurrency(s.commissionAmount)}`
                  : s.commissionRate != null ? ` · comisión ${s.commissionRate}%` : ''}
                {s.repeatEveryDays ? ` · volver cada ${s.repeatEveryDays} días` : ''}
                {s.atCustomerDefault ? ' · a domicilio' : ''}
                {s.warrantyDays ? ` · garantía ${s.warrantyDays} días` : ''}
              </p>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" aria-label={`Editar ${s.name}`} onClick={() => open(s)}><Pencil className="h-4 w-4" /></Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            <DialogDescription>El precio es solo lo que cobras por el servicio; las piezas o materiales se suman en cada orden.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sv-name">Nombre</Label>
                <Input id="sv-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Corte, baño, cambio de aceite…" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sv-price">Precio (RD$)</Label>
                  <Input id="sv-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1000" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sv-warranty">Garantía (días)</Label>
                  <Input id="sv-warranty" inputMode="numeric" value={draft.warrantyDays} onChange={(e) => setDraft({ ...draft, warrantyDays: e.target.value.replace(/[^\d]/g, '') })} placeholder="Por defecto" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="sv-itbis">Lleva ITBIS</Label>
                <Switch id="sv-itbis" checked={draft.itbis} onCheckedChange={(v) => setDraft({ ...draft, itbis: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sv-dur">Duración (min)</Label>
                  <Input id="sv-dur" inputMode="numeric" value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: e.target.value.replace(/[^\d]/g, '') })} placeholder="45" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sv-repeat">Volver cada (días)</Label>
                  <Input id="sv-repeat" inputMode="numeric" value={draft.repeatEveryDays} onChange={(e) => setDraft({ ...draft, repeatEveryDays: e.target.value.replace(/[^\d]/g, '') })} placeholder="Sin recordatorio" />
                </div>
              </div>
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Comisión</legend>
                {COMISIONES.map(([v, t]) => (
                  <label key={v} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio" name="sv-comision" checked={draft.comision === v}
                      onChange={() => setDraft({ ...draft, comision: v, comisionValor: '' })}
                    />
                    {t}
                  </label>
                ))}
                {draft.comision !== 'persona' && (
                  <Input
                    aria-label={draft.comision === 'porcentaje' ? 'Porcentaje de comisión' : 'Monto de comisión'}
                    inputMode="decimal" className="max-w-[10rem]" value={draft.comisionValor}
                    onChange={(e) => setDraft({ ...draft, comisionValor: e.target.value.replace(/[^\d.]/g, '') })}
                    placeholder={draft.comision === 'porcentaje' ? '10' : '200'}
                  />
                )}
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sv-type">Para qué tipo de ficha</Label>
                  <select id="sv-type" className={SELECT_CLASS} value={draft.equipmentTypeId} onChange={(e) => setDraft({ ...draft, equipmentTypeId: e.target.value })}>
                    <option value={NINGUNO}>Cualquiera</option>
                    {config.equipmentTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sv-cat">Piezas sugeridas de</Label>
                  <select id="sv-cat" className={SELECT_CLASS} value={draft.partCategoryId} onChange={(e) => setDraft({ ...draft, partCategoryId: e.target.value })}>
                    <option value={NINGUNO}>Cualquier categoría</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="sv-home">A domicilio por defecto</Label>
                <Switch id="sv-home" checked={draft.atCustomerDefault} onCheckedChange={(v) => setDraft({ ...draft, atCustomerDefault: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="sv-es">Factura como servicio (e-CF)</Label>
                <Switch id="sv-es" checked={draft.esServicio} onCheckedChange={(v) => setDraft({ ...draft, esServicio: v })} />
              </div>
              {puedeUsarExistente && (
                <div className="space-y-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox" checked={usarExistente}
                      onChange={(e) => {
                        setUsarExistente(e.target.checked);
                        if (!e.target.checked) setDraft({ ...draft, linkProduct: undefined });
                      }}
                    />
                    Usar un artículo que ya existe
                  </label>
                  {usarExistente && (draft.linkProduct ? (
                    <p className="text-sm">
                      {draft.linkProduct.name} · {formatCurrency(draft.linkProduct.price)}{' '}
                      <button type="button" className="text-primary underline" onClick={() => setDraft({ ...draft, linkProduct: undefined })}>Cambiar</button>
                    </p>
                  ) : (
                    <>
                      <Input aria-label="Buscar artículo" placeholder="Buscar artículo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                      <div className="max-h-40 overflow-y-auto rounded-md border">
                        {resultados.length === 0 && <p className="p-2 text-sm text-muted-foreground">Sin resultados.</p>}
                        {resultados.map((a) => (
                          <button
                            key={a.id} type="button"
                            className="flex w-full justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
                            onClick={() => setDraft({
                              ...draft, linkProduct: a,
                              name: draft.name.trim() ? draft.name : a.name,
                              price: draft.price.trim() ? draft.price : String(a.price),
                            })}
                          >
                            <span className="truncate">{a.name}</span><span>{formatCurrency(a.price)}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="sv-desc">Descripción (opcional)</Label>
                <Input id="sv-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="sv-active">Activo</Label>
                <Switch id="sv-active" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancelar</Button>
            <Button onClick={save} disabled={saving || esCargando}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
