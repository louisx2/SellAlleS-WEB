'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCategories } from '@/context/category-provider';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import type { ServiceType } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';

const NINGUNO = 'none';

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: string;
  itbis: boolean;
  equipmentTypeId: string;
  partCategoryId: string;
  warrantyDays: string;
  isActive: boolean;
};

export function CatalogTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const { categories } = useCategories();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (s?: ServiceType) => setDraft({
    id: s?.id,
    name: s?.name ?? '',
    description: s?.description ?? '',
    price: s ? String(s.price) : '',
    itbis: s?.itbis ?? false,
    equipmentTypeId: s?.equipmentTypeId ?? NINGUNO,
    partCategoryId: s?.partCategoryId ?? NINGUNO,
    warrantyDays: s?.warrantyDays?.toString() ?? '',
    isActive: s?.isActive ?? true,
  });

  const save = async () => {
    if (!draft || !config.branchId) return;
    const price = Number(draft.price);
    if (!draft.name.trim()) { toast({ title: 'Escribe el nombre del servicio', variant: 'destructive' }); return; }
    if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      toast({ title: 'Escribe el precio de la mano de obra', variant: 'destructive' }); return;
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
      },
    });
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: draft.id ? 'Servicio actualizado' : 'Servicio creado' });
    setDraft(null);
    config.reload();
  };

  const typeName = (id?: string) => config.equipmentTypes.find((t) => t.id === id)?.name;
  const categoryName = (id?: string) => categories.find((c) => c.id === id)?.name;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Catálogo de servicios</CardTitle>
          <CardDescription>
            La mano de obra que cobras: cambio de pantalla, batería, pin de carga… La pieza se
            elige en cada caso, con su precio. Cada servicio queda también como artículo de servicio
            en Inventario, así que se cobra en el POS y sale como servicio en el e-CF.
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
                {s.warrantyDays ? ` · garantía ${s.warrantyDays} días` : ''}
              </p>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" aria-label={`Editar ${s.name}`} onClick={() => open(s)}><Pencil className="h-4 w-4" /></Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            <DialogDescription>El precio es solo la mano de obra; las piezas se suman en cada caso.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sv-name">Nombre</Label>
                <Input id="sv-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Cambio de pantalla" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sv-price">Mano de obra (RD$)</Label>
                  <Input id="sv-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, '') })} placeholder="1000" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sv-warranty">Garantía (días)</Label>
                  <Input id="sv-warranty" inputMode="numeric" value={draft.warrantyDays} onChange={(e) => setDraft({ ...draft, warrantyDays: e.target.value.replace(/[^\d]/g, '') })} placeholder="Por defecto del taller" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="sv-itbis">Lleva ITBIS</Label>
                <Switch id="sv-itbis" checked={draft.itbis} onCheckedChange={(v) => setDraft({ ...draft, itbis: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sv-type">Para el equipo</Label>
                  <Select value={draft.equipmentTypeId} onValueChange={(v) => setDraft({ ...draft, equipmentTypeId: v })}>
                    <SelectTrigger id="sv-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Cualquiera</SelectItem>
                      {config.equipmentTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sv-cat">Piezas sugeridas de</Label>
                  <Select value={draft.partCategoryId} onValueChange={(v) => setDraft({ ...draft, partCategoryId: v })}>
                    <SelectTrigger id="sv-cat"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Cualquier categoría</SelectItem>
                      {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
