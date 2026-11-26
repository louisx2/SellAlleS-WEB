'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
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
import { Pencil, Plus, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { supabase } from '@/lib/supabase/client';
import { fieldKey } from '@/lib/taller';
import type { VehicleExtraField, VehicleType } from '@/lib/types';

type Draft = { id?: string; name: string; extraFields: VehicleExtraField[]; isActive: boolean };

// Configuración de Motopréstamos. En 2A: los tipos de vehículo (Motor, Pasola,
// Carro…) con sus campos extra, como los tipos de equipo del Taller.
export default function MotosConfigPage() {
  const { toast } = useToast();
  const canEdit = usePermission('motos-config', 'edit');
  const { types, reload } = useVehiculos();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const abrir = (t?: VehicleType) =>
    setDraft(t ? { id: t.id, name: t.name, extraFields: t.extraFields, isActive: t.isActive } : { name: '', extraFields: [], isActive: true });

  const guardar = async () => {
    if (!draft || !draft.name.trim()) return;
    const extraFields = draft.extraFields
      .filter((f) => f.label.trim())
      .map((f) => ({ ...f, label: f.label.trim(), key: f.key || fieldKey(f.label) }));
    setSaving(true);
    const fila = { name: draft.name.trim(), extra_fields: extraFields, is_active: draft.isActive };
    const { error } = draft.id
      ? await supabase.from('vehicle_types').update(fila).eq('id', draft.id)
      : await supabase.from('vehicle_types').insert({ ...fila, position: types.length });
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    setDraft(null);
    await reload();
  };

  return (
    <div>
      <PageHeader title="Configuración de Motopréstamos" />
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Tipos de vehículo</CardTitle>
            <CardDescription>Motor, pasola, carro… y los datos extra que se piden de cada uno al ingresarlo.</CardDescription>
          </div>
          {canEdit && <Button size="sm" onClick={() => abrir()}><Plus className="mr-2 h-4 w-4" /> Nuevo tipo</Button>}
        </CardHeader>
        <CardContent className="space-y-2">
          {types.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay tipos de vehículo.</p>}
          {types.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{t.name} {!t.isActive && <Badge variant="secondary">Inactivo</Badge>}</p>
                <p className="text-xs text-muted-foreground">
                  {t.extraFields.length ? t.extraFields.map((f) => f.label).join(', ') : 'Sin datos extra'}
                </p>
              </div>
              {canEdit && <Button variant="ghost" size="icon" onClick={() => abrir(t)} aria-label={`Editar ${t.name}`}><Pencil className="h-4 w-4" /></Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar tipo' : 'Nuevo tipo de vehículo'}</DialogTitle>
            <DialogDescription>Los datos fijos (marca, modelo, año, color, chasis, motor, placa, matrícula, cilindraje) se piden siempre.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="tipo-nombre">Nombre</Label>
                <Input id="tipo-nombre" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Motor" />
              </div>
              <div className="grid gap-2">
                <Label>Datos extra</Label>
                {draft.extraFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={f.label} placeholder="Ej: Kilometraje" onChange={(e) => {
                      const extraFields = [...draft.extraFields];
                      extraFields[i] = { ...f, label: e.target.value };
                      setDraft({ ...draft, extraFields });
                    }} />
                    <Select value={f.type} onValueChange={(v) => {
                      const extraFields = [...draft.extraFields];
                      extraFields[i] = { ...f, type: v as VehicleExtraField['type'] };
                      setDraft({ ...draft, extraFields });
                    }}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Texto</SelectItem>
                        <SelectItem value="number">Número</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" aria-label="Quitar" onClick={() => setDraft({ ...draft, extraFields: draft.extraFields.filter((_, j) => j !== i) })}>
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, extraFields: [...draft.extraFields, { key: '', label: '', type: 'text' }] })}>
                  <Plus className="mr-2 h-4 w-4" /> Agregar dato
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="tipo-activo">Activo</Label>
                <Switch id="tipo-activo" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving || !draft?.name.trim()}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
