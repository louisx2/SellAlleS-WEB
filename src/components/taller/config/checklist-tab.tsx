'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { ChecklistItem } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';

const TODOS = 'all';

export function ChecklistTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const [scope, setScope] = useState<string>(() => config.equipmentTypes[0]?.id ?? TODOS);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  // Los chequeos de este tipo de ficha (o los que aplican a todos).
  const items = useMemo(
    () => config.checklist
      .filter((i) => (scope === TODOS ? !i.equipmentTypeId : i.equipmentTypeId === scope))
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)),
    [config.checklist, scope],
  );

  const fail = (error: { message: string }) =>
    toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });

  const add = async () => {
    const text = label.trim();
    if (!text) return;
    setBusy(true);
    const { error } = await supabase.from('service_checklist_items').insert({
      equipment_type_id: scope === TODOS ? null : scope,
      label: text,
      position: (items[items.length - 1]?.position ?? -1) + 1,
    });
    setBusy(false);
    if (error) return fail(error);
    setLabel('');
    config.reload();
  };

  const patch = async (item: ChecklistItem, row: Record<string, unknown>) => {
    const { error } = await supabase.from('service_checklist_items').update(row).eq('id', item.id);
    if (error) return fail(error);
    config.reload();
  };

  // Intercambia la posición con el vecino. Se renumera la lista entera para que
  // dos con la misma posición (los de la plantilla) queden en un orden fijo.
  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const ordered = [...items];
    [ordered[index], ordered[j]] = [ordered[j], ordered[index]];
    setBusy(true);
    await Promise.all(ordered.map((it, pos) =>
      it.position === pos ? null : supabase.from('service_checklist_items').update({ position: pos }).eq('id', it.id)));
    setBusy(false);
    config.reload();
  };

  const remove = async (item: ChecklistItem) => {
    if (!confirm(`¿Quitar «${item.label}»? Las órdenes que ya lo anotaron lo conservan.`)) return;
    const { error } = await supabase.from('service_checklist_items').delete().eq('id', item.id);
    if (error) return fail(error);
    config.reload();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chequeos de llegada</CardTitle>
        <CardDescription>
          Lo que se revisa antes de atender. Se contesta Sí, No o No se pudo probar, con
          una nota. Cada orden guarda lo que se anotó: quitar un chequeo no cambia las órdenes viejas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="ck-scope">Chequeos para</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger id="ck-scope"><SelectValue /></SelectTrigger>
            <SelectContent>
              {config.equipmentTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
              <SelectItem value={TODOS}>Todos los tipos de ficha</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 text-xs font-medium text-muted-foreground">
          <span>Chequeo</span>
          <span className="w-24 text-center">Obligatorio</span>
          <span className="w-24 text-center">En rápida</span>
          <span className="w-28" />
        </div>
        <div className="space-y-2">
          {items.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Sin chequeos {scope === TODOS ? 'para todos los tipos de ficha' : 'para este tipo'} todavía.
            </p>
          )}
          {items.map((item, i) => (
            <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-md border p-3">
              <Input
                aria-label="Nombre del chequeo"
                defaultValue={item.label}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.label) patch(item, { label: v });
                }}
                className={item.isActive ? '' : 'opacity-60'}
              />
              <label className="flex w-24 items-center justify-between gap-2 text-sm sm:justify-center">
                <span className="sm:hidden">Obligatorio</span>
                <Switch checked={item.required} disabled={!canEdit} onCheckedChange={(v) => patch(item, { required: v })} aria-label="Obligatorio al ingresar" />
              </label>
              <label className="flex w-24 items-center justify-between gap-2 text-sm sm:justify-center">
                <span className="sm:hidden">En rápida</span>
                <Switch checked={item.requiredQuick} disabled={!canEdit} onCheckedChange={(v) => patch(item, { required_quick: v })} aria-label="Obligatorio en reparación rápida" />
              </label>
              <div className="flex w-28 justify-end gap-1">
                {canEdit && (
                  <>
                    <Button variant="ghost" size="icon" aria-label="Subir" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Bajar" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Quitar" className="text-destructive" onClick={() => remove(item)}><Trash className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); add(); }}
          >
            <Input
              aria-label="Nuevo chequeo"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej.: Faltan teclas, Face ID funciona, Luces…"
            />
            <Button type="submit" disabled={busy || !label.trim()}><Plus className="mr-1 h-4 w-4" />Agregar</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
