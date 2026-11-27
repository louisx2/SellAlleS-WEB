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
import { Pencil, Plus, Trash, LayoutTemplate } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { RUBROS, fieldKey, tiposQueFaltan } from '@/lib/taller';
import type { EquipmentExtraField, EquipmentType } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';
import { aplicarPlantilla } from '../aplicar-plantilla';

type Draft = {
  id?: string;
  name: string;
  brandLabel: string;
  modelLabel: string;
  serialLabel: string;
  /** Sin «Lleva», la etiqueta se guarda como null (no se pide ese dato). */
  lleva: { brand: boolean; model: boolean; serial: boolean };
  asksPassword: boolean;
  staysInShop: boolean;
  isRepair: boolean;
  extraFields: EquipmentExtraField[];
  isActive: boolean;
};

const EMPTY: Draft = {
  name: '', brandLabel: 'Marca', modelLabel: 'Modelo', serialLabel: 'Serie',
  lleva: { brand: true, model: true, serial: true },
  asksPassword: false, staysInShop: true, isRepair: false, extraFields: [], isActive: true,
};

// Los diálogos de esta pantalla no usan el Select de Radix (se congela): <select> nativo.
const SELECT_CLASS =
  'flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const DATOS = [
  ['brand', 'brandLabel', 'Marca, Nombre…'],
  ['model', 'modelLabel', 'Modelo, Raza…'],
  ['serial', 'serialLabel', 'IMEI, Serie, Placa…'],
] as const;

export function EquipmentTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (t?: EquipmentType) =>
    setDraft(t
      ? {
          id: t.id, name: t.name,
          brandLabel: t.brandLabel ?? 'Marca', modelLabel: t.modelLabel ?? 'Modelo', serialLabel: t.serialLabel ?? 'Serie',
          lleva: { brand: t.brandLabel !== null, model: t.modelLabel !== null, serial: t.serialLabel !== null },
          asksPassword: t.asksPassword, staysInShop: t.staysInShop, isRepair: t.isRepair,
          extraFields: t.extraFields, isActive: t.isActive,
        }
      : { ...EMPTY, lleva: { ...EMPTY.lleva } });

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast({ title: 'Escribe el nombre del tipo de ficha', variant: 'destructive' }); return; }
    const fields = draft.extraFields
      .filter((f) => f.label.trim())
      .map((f) => ({ ...f, label: f.label.trim(), key: f.key || fieldKey(f.label) }));
    const keys = new Set<string>();
    for (const f of fields) {
      if (keys.has(f.key)) { toast({ title: `Hay dos campos llamados «${f.label}»`, variant: 'destructive' }); return; }
      keys.add(f.key);
    }
    const label = (lleva: boolean, v: string, def: string) => (lleva ? v.trim() || def : null);
    const row = {
      name: draft.name.trim(),
      brand_label: label(draft.lleva.brand, draft.brandLabel, 'Marca'),
      model_label: label(draft.lleva.model, draft.modelLabel, 'Modelo'),
      serial_label: label(draft.lleva.serial, draft.serialLabel, 'Serie'),
      asks_password: draft.asksPassword,
      stays_in_shop: draft.staysInShop,
      is_repair: draft.isRepair,
      extra_fields: fields,
      is_active: draft.isActive,
    };
    setSaving(true);
    const { error } = draft.id
      ? await supabase.from('service_equipment_types').update(row).eq('id', draft.id)
      : await supabase.from('service_equipment_types').insert({ ...row, position: config.equipmentTypes.length });
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: draft.id ? 'Tipo de ficha actualizado' : 'Tipo de ficha creado' });
    setDraft(null);
    config.reload();
  };

  const remove = async (t: EquipmentType) => {
    if (!confirm(`¿Borrar «${t.name}»? Sus chequeos se borran también. Las órdenes que ya lo usan no cambian.`)) return;
    const { error } = await supabase.from('service_equipment_types').delete().eq('id', t.id);
    if (error) { toast({ title: 'No se pudo borrar', description: error.message, variant: 'destructive' }); return; }
    config.reload();
  };

  // Plantilla por rubro: crea los tipos de ficha que falten (por nombre) con sus chequeos.
  const loadTemplate = async (key: string) => {
    if (!key) return;
    const existentes = config.equipmentTypes.map((t) => t.name);
    const aDomicilio = RUBROS.find((r) => r.key === key)?.aDomicilio;
    if (tiposQueFaltan(key, existentes).length === 0 && !aDomicilio) {
      toast({ title: RUBROS.find((r) => r.key === key)?.equipos.length ? 'Ya tienes esos tipos de ficha' : 'Este rubro no necesita tipos de ficha' });
      return;
    }
    setSaving(true);
    const r = await aplicarPlantilla(key, { existentes });
    setSaving(false);
    if (r.error) toast({ title: 'No se pudo cargar la plantilla', description: r.error, variant: 'destructive' });
    else toast({
      title: r.creados.length ? `Listo: ${r.creados.join(', ')}` : 'Listo',
      description: aDomicilio ? 'Las órdenes nuevas quedan a domicilio.' : 'Ajusta los chequeos en la pestaña Chequeos.',
    });
    config.reload();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Tipos de ficha</CardTitle>
          <CardDescription>
            Qué se atiende: un perro, un vehículo, un teléfono… Cada tipo dice qué datos se piden
            (marca, modelo, serie), si se anota la clave y qué campos propios lleva.
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {config.equipmentTypes.length > 0 && (
              <select
                value="" onChange={(e) => loadTemplate(e.target.value)} disabled={saving}
                aria-label="Cargar plantilla por rubro"
                className="flex h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Cargar plantilla…</option>
                {RUBROS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            )}
            <Button size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" />Nuevo tipo de ficha</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {config.equipmentTypes.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground space-y-3">
            <p>Todavía no hay tipos de ficha. Empieza con la plantilla de tu rubro (todo se puede editar después):</p>
            {canEdit && (
              <div className="flex flex-wrap justify-center gap-2">
                {RUBROS.map((r) => (
                  <Button key={r.key} variant="outline" size="sm" onClick={() => loadTemplate(r.key)} disabled={saving}>
                    <LayoutTemplate className="mr-1 h-4 w-4" />{r.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {config.equipmentTypes.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                {!t.isActive && <Badge variant="outline">Inactivo</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {[t.brandLabel, t.modelLabel, t.serialLabel].filter(Boolean).join(', ') || 'Sin datos fijos'}
                {t.staysInShop ? ' · se deja en el negocio' : ''}
                {t.isRepair ? ' · de reparación' : ''}
                {t.asksPassword ? ' · pide clave o patrón' : ''}
                {t.extraFields.length > 0 ? ` · ${t.extraFields.map((f) => f.label).join(', ')}` : ''}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label={`Editar ${t.name}`} onClick={() => open(t)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Borrar ${t.name}`} className="text-destructive" onClick={() => remove(t)}><Trash className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar tipo de ficha' : 'Nuevo tipo de ficha'}</DialogTitle>
            <DialogDescription>Los datos que se piden al atender algo de este tipo.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="eq-name">Nombre</Label>
                <Input id="eq-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Perro, Vehículo, Teléfono…" />
              </div>
              <div className="space-y-2">
                <Label>Datos que se piden</Label>
                {DATOS.map(([k, f, ph]) => (
                  <div key={k} className="flex items-center gap-3">
                    <Input
                      aria-label={`Etiqueta de ${k === 'brand' ? 'marca' : k === 'model' ? 'modelo' : 'serie'}`}
                      value={draft[f]} disabled={!draft.lleva[k]} placeholder={ph}
                      onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    />
                    <label className="flex shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox" checked={draft.lleva[k]}
                        onChange={(e) => setDraft({ ...draft, lleva: { ...draft.lleva, [k]: e.target.checked } })}
                      />
                      Lleva
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-pass">Pide clave o patrón</Label>
                <Switch id="eq-pass" checked={draft.asksPassword} onCheckedChange={(v) => setDraft({ ...draft, asksPassword: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-stays">Se deja en el negocio</Label>
                <Switch id="eq-stays" checked={draft.staysInShop} onCheckedChange={(v) => setDraft({ ...draft, staysInShop: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-repair">De reparación</Label>
                <Switch id="eq-repair" checked={draft.isRepair} onCheckedChange={(v) => setDraft({ ...draft, isRepair: v })} />
              </div>
              <div className="space-y-2">
                <Label>Campos propios</Label>
                {draft.extraFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label={`Nombre del campo ${i + 1}`}
                      value={f.label}
                      onChange={(e) => {
                        const extraFields = [...draft.extraFields];
                        extraFields[i] = { ...f, label: e.target.value, key: f.key && draft.id ? f.key : fieldKey(e.target.value) };
                        setDraft({ ...draft, extraFields });
                      }}
                      placeholder="Ej.: Kilometraje, Tamaño"
                    />
                    <select
                      value={f.type} aria-label="Tipo de dato" className={SELECT_CLASS}
                      onChange={(e) => {
                        const extraFields = [...draft.extraFields];
                        extraFields[i] = { ...f, type: e.target.value as EquipmentExtraField['type'] };
                        setDraft({ ...draft, extraFields });
                      }}
                    >
                      <option value="text">Texto</option>
                      <option value="number">Número</option>
                    </select>
                    <Button
                      variant="ghost" size="icon" aria-label="Quitar campo" className="text-destructive"
                      onClick={() => setDraft({ ...draft, extraFields: draft.extraFields.filter((_, j) => j !== i) })}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm"
                  onClick={() => setDraft({ ...draft, extraFields: [...draft.extraFields, { key: '', label: '', type: 'text' }] })}
                >
                  <Plus className="mr-1 h-4 w-4" />Agregar campo
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-active">Activo (se ofrece al atender)</Label>
                <Switch id="eq-active" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
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
