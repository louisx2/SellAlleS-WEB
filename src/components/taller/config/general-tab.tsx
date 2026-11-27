'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useLocations } from '@/context/location-provider';
import { supabase } from '@/lib/supabase/client';
import type { TallerConfig } from '../use-taller-config';

const NINGUNA = 'none';

export function GeneralTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const { locations } = useLocations();
  const [locationId, setLocationId] = useState<string>(NINGUNA);
  const [hideInPos, setHideInPos] = useState(false);
  const [terms, setTerms] = useState('');
  const [warranty, setWarranty] = useState('');
  const [atCustomer, setAtCustomer] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocationId(config.settings?.partsLocationId ?? NINGUNA);
    setHideInPos(config.settings?.hidePartsInPos ?? false);
    setTerms(config.settings?.terms ?? '');
    setWarranty(config.settings?.defaultWarrantyDays?.toString() ?? '');
    setAtCustomer(config.settings?.defaultAtCustomer ?? false);
  }, [config.settings]);

  const save = async () => {
    if (!config.branchId) return;
    const dias = warranty.trim() === '' ? null : Number(warranty);
    if (dias !== null && (!Number.isInteger(dias) || dias < 0)) {
      toast({ title: 'La garantía va en días enteros', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('taller_settings').upsert({
      branch_id: config.branchId,
      parts_location_id: locationId === NINGUNA ? null : locationId,
      hide_parts_in_pos: locationId === NINGUNA ? false : hideInPos,
      terms: terms.trim() || null,
      default_warranty_days: dias,
      default_at_customer: atCustomer,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Ajustes guardados' });
    config.reload();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inventario de piezas</CardTitle>
          <CardDescription>
            Las piezas que se ofrecen en una orden salen de esta ubicación de la sucursal. Crea la
            ubicación en <span className="font-medium">Ubicaciones</span> (por ejemplo «Repuestos») y
            asígnasela a las piezas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="parts-location">Ubicación de repuestos</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={!canEdit}>
              <SelectTrigger id="parts-location"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NINGUNA}>Todo el inventario de la sucursal</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="hide-in-pos">Ocultar estas piezas en el POS</Label>
              <p className="text-sm text-muted-foreground">
                Para que en el mostrador no se vendan por error. Siguen apareciendo en Inventario.
              </p>
            </div>
            <Switch
              id="hide-in-pos"
              checked={hideInPos}
              onCheckedChange={setHideInPos}
              disabled={!canEdit || locationId === NINGUNA}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recibo de recepción</CardTitle>
          <CardDescription>Lo que se imprime al recibir una orden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="terms">Condiciones</Label>
            <Textarea
              id="terms"
              rows={5}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              disabled={!canEdit}
              placeholder="Ej.: Los equipos no retirados en 60 días pasan a disposición del negocio. La garantía no cubre golpes ni humedad."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="warranty">Garantía por defecto (días)</Label>
            <Input
              id="warranty"
              inputMode="numeric"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value.replace(/[^\d]/g, ''))}
              disabled={!canEdit}
              placeholder="Ej.: 30"
              className="max-w-[10rem]"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <Label htmlFor="at-customer">Las órdenes nuevas son a domicilio</Label>
            <Switch id="at-customer" checked={atCustomer} onCheckedChange={setAtCustomer} disabled={!canEdit} />
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="lg:col-span-2 flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajustes'}</Button>
        </div>
      )}
    </div>
  );
}
