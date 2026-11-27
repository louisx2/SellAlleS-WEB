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
import { Pencil, Plus, Trash, LayoutTemplate } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { RUBROS, fieldKey } from '@/lib/taller';
import type { EquipmentExtraField, EquipmentType } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';

type Draft = {
  id?: string;
  name: string;
  serialLabel: string;
  asksPassword: boolean;
  extraFields: EquipmentExtraField[];
  isActive: boolean;
};

const EMPTY: Draft = { name: '', serialLabel: 'Serie', asksPassword: false, extraFields: [], isActive: true };

export function EquipmentTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (t?: EquipmentType) =>
    setDraft(t
      ? { id: t.id, name: t.name, serialLabel: t.serialLabel ?? 'Serie', asksPassword: t.asksPassword, extraFields: t.extraFields, isActive: t.isActive }
      : { ...EMPTY });

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast({ title: 'Escribe el nombre del tipo de equipo', variant: 'destructive' }); return; }
    const fields = draft.extraFields
      .filter((f) => f.label.trim())
      .map((f) => ({ ...f, label: f.label.trim(), key: f.key || fieldKey(f.label) }));
    const keys = new Set<string>();
    for (const f of fields) {
      if (keys.has(f.key)) { toast({ title: `Hay dos campos llamados «${f.label}»`, variant: 'destructive' }); return; }
      keys.add(f.key);
    }
    const row = {
      name: draft.name.trim(),
      serial_label: draft.serialLabel.trim() || 'Serie',
      asks_password: draft.asksPassword,
      extra_fields: fields,
      is_active: draft.isActive,
    };
    setSaving(true);
    const { error } = draft.id
      ? await supabase.from('service_equipment_types').update(row).eq('id', draft.id)
      : await supabase.from('service_equipment_types').insert({ ...row, position: config.equipmentTypes.length });
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: draft.id ? 'Tipo de equipo actualizado' : 'Tipo de equipo creado' });
    setDraft(null);
    config.reload();
  };

  const remove = async (t: EquipmentType) => {
    if (!confirm(`¿Borrar «${t.name}»? Sus chequeos se borran también. Los casos que ya lo usan no cambian.`)) return;
    const { error } = await supabase.from('service_equipment_types').delete().eq('id', t.id);
    if (error) { toast({ title: 'No se pudo borrar', description: error.message, variant: 'destructive' }); return; }
    config.reload();
  };

  // Plantilla por rubro: crea los tipos de equipo que falten (por nombre) con sus
  // chequeos. Los dos primeros chequeos quedan obligatorios, también en rápida.
  const loadTemplate = async (key: string) => {
    const rubro = RUBROS.find((r) => r.key === key);
    if (!rubro) return;
    const existentes = new Set(config.equipmentTypes.map((t) => t.name.trim().toLowerCase()));
    const nuevos = rubro.equipos.filter((e) => !existentes.has(e.name.toLowerCase()));
    if (nuevos.length === 0) { toast({ title: 'Ya tienes esos tipos de equipo' }); return; }
    setSaving(true);
    let pos = config.equipmentTypes.length;
    for (const eq of nuevos) {
      const { data, error } = await supabase.from('service_equipment_types').insert({
        name: eq.name, serial_label: eq.serialLabel, asks_password: eq.asksPassword,
        extra_fields: eq.extraFields ?? [], position: pos++,
      }).select('id').single();
      if (error || !data) {
        setSaving(false);
        toast({ title: 'No se pudo cargar la plantilla', description: error?.message, variant: 'destructive' });
        return;
      }
      await supabase.from('service_checklist_items').insert(
        eq.checklist.map((label, i) => ({
          equipment_type_id: data.id, label, position: i, required: i < 2, required_quick: i < 2,
        })),
      );
    }
    setSaving(false);
    toast({ title: `Listo: ${nuevos.map((e) => e.name).join(', ')}`, description: 'Ajusta los chequeos en la pestaña Chequeos.' });
    config.reload();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Tipos de equipo</CardTitle>
          <CardDescription>
            Qué reparas: teléfonos, laptops, vehículos… Cada tipo dice cómo se llama su número de
            serie, si se anota la clave y qué datos extra lleva.
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {config.equipmentTypes.length > 0 && (
              <Select value="" onValueChange={loadTemplate} disabled={saving}>
                <SelectTrigger className="h-9 w-48" aria-label="Cargar plantilla por rubro"><SelectValue placeholder="Cargar plantilla…" /></SelectTrigger>
                <SelectContent>
                  {RUBROS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" />Nuevo tipo</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {config.equipmentTypes.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground space-y-3">
            <p>Todavía no hay tipos de equipo. Empieza con la plantilla de tu rubro (todo se puede editar después):</p>
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
                {t.serialLabel}
                {t.asksPassword ? ' · pide clave/patrón' : ''}
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
            <DialogTitle>{draft?.id ? 'Editar tipo de equipo' : 'Nuevo tipo de equipo'}</DialogTitle>
            <DialogDescription>Los datos que se piden al ingresar un equipo de este tipo.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="eq-name">Nombre</Label>
                  <Input id="eq-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Teléfono, Laptop, Vehículo…" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eq-serial">Número de serie se llama</Label>
                  <Input id="eq-serial" value={draft.serialLabel} onChange={(e) => setDraft({ ...draft, serialLabel: e.target.value })} placeholder="IMEI, Serie, Placa…" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-pass">Anotar clave o patrón de desbloqueo</Label>
                <Switch id="eq-pass" checked={draft.asksPassword} onCheckedChange={(v) => setDraft({ ...draft, asksPassword: v })} />
              </div>
              <div className="space-y-2">
                <Label>Datos extra</Label>
                {draft.extraFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label={`Nombre del dato ${i + 1}`}
                      value={f.label}
                      onChange={(e) => {
                        const extraFields = [...draft.extraFields];
                        extraFields[i] = { ...f, label: e.target.value, key: f.key && draft.id ? f.key : fieldKey(e.target.value) };
                        setDraft({ ...draft, extraFields });
                      }}
                      placeholder="Ej.: Kilometraje, Color"
                    />
                    <Select
                      value={f.type}
                      onValueChange={(v) => {
                        const extraFields = [...draft.extraFields];
                        extraFields[i] = { ...f, type: v as EquipmentExtraField['type'] };
                        setDraft({ ...draft, extraFields });
                      }}
                    >
                      <SelectTrigger className="w-32" aria-label="Tipo de dato"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Texto</SelectItem>
                        <SelectItem value="number">Número</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon" aria-label="Quitar dato" className="text-destructive"
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
                  <Plus className="mr-1 h-4 w-4" />Agregar dato
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="eq-active">Activo (se ofrece al ingresar)</Label>
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
