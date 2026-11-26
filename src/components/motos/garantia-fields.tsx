'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { rowToVehicleType } from '@/lib/supabase/mappers';
import { fetchVehiculosDelCliente } from '@/hooks/use-vehiculos';
import { vehicleLabel, vehiculosParaGarantia, VEHICLE_STATUS } from '@/lib/motos';
import type { GarantiaInput } from '@/context/loan-provider';
import type { Vehicle, VehicleType } from '@/lib/types';

const SIN_TIPO = 'sin-tipo';

export type GarantiaForm = {
  activa: boolean;
  modo: 'nueva' | 'existente';
  vehicleId: string;
  vehicleTypeId: string;
  brand: string; model: string; year: string; color: string; chassis: string;
  engineNumber: string; plate: string; registrationNumber: string;
  custodia: boolean;
  ubicacion: string;
};

export const garantiaVacia = (): GarantiaForm => ({
  activa: false, modo: 'nueva', vehicleId: '', vehicleTypeId: SIN_TIPO,
  brand: '', model: '', year: '', color: '', chassis: '', engineNumber: '', plate: '', registrationNumber: '',
  custodia: true, ubicacion: '',
});

/** Qué le falta a la garantía para poder prestar (null = nada). */
export function faltaEnGarantia(g: GarantiaForm): string | null {
  if (!g.activa) return null;
  if (g.modo === 'existente') return g.vehicleId ? null : 'Elige la moto del cliente.';
  if (!g.chassis.trim()) return 'Escribe el chasis de la moto.';
  const year = g.year.trim();
  if (year && !/^\d{4}$/.test(year)) return 'El año de la moto no es válido.';
  return null;
}

export function garantiaParaGuardar(g: GarantiaForm): GarantiaInput {
  const base = { matriculaEnCustodia: g.custodia, ubicacion: g.custodia ? g.ubicacion : '' };
  if (g.modo === 'existente') return { ...base, vehicleId: g.vehicleId };
  return {
    ...base,
    vehiculo: {
      vehicleTypeId: g.vehicleTypeId === SIN_TIPO ? '' : g.vehicleTypeId,
      brand: g.brand, model: g.model, year: g.year.trim() ? Number(g.year) : undefined, color: g.color,
      chassis: g.chassis, engineNumber: g.engineNumber, plate: g.plate, registrationNumber: g.registrationNumber,
    },
  };
}

interface Props {
  value: GarantiaForm;
  onChange: (g: GarantiaForm) => void;
  customerId?: string;
  branchId?: string;
}

type CampoTexto = 'brand' | 'model' | 'year' | 'color' | 'chassis' | 'engineNumber' | 'plate' | 'registrationNumber';

// La sección Garantía del préstamo: la moto del cliente (nueva o ya registrada) y
// si la matrícula se queda en custodia.
export function GarantiaFields({ value: g, onChange, customerId, branchId }: Props) {
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [suyas, setSuyas] = useState<Vehicle[]>([]);
  const set = <K extends keyof GarantiaForm>(k: K, v: GarantiaForm[K]) => onChange({ ...g, [k]: v });

  useEffect(() => {
    if (!g.activa) return;
    supabase.from('vehicle_types').select('*').order('position').order('name')
      .then(({ data }) => setTypes((data ?? []).map(rowToVehicleType).filter((t) => t.isActive)));
  }, [g.activa]);

  useEffect(() => {
    if (!g.activa || !customerId) { setSuyas([]); return; }
    fetchVehiculosDelCliente(customerId).then(setSuyas).catch(() => setSuyas([]));
  }, [g.activa, customerId]);

  const elegibles = useMemo(
    () => (customerId && branchId ? vehiculosParaGarantia(suyas, customerId, branchId) : []),
    [suyas, customerId, branchId],
  );
  const falta = faltaEnGarantia(g);

  const campo = (k: CampoTexto, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`gar-${k}`}>{label}</Label>
      <Input id={`gar-${k}`} value={g[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
    </div>
  );

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="gar-activa" className="font-medium">Con la moto del cliente en garantía</Label>
        <Switch id="gar-activa" checked={g.activa} onCheckedChange={(v) => set('activa', v)} />
      </div>
      {g.activa && (
        <>
          <Select value={g.modo} onValueChange={(v) => onChange({ ...g, modo: v as GarantiaForm['modo'], vehicleId: '' })}>
            <SelectTrigger aria-label="De dónde sale la moto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nueva">Registrar moto</SelectItem>
              <SelectItem value="existente">Una suya ya registrada</SelectItem>
            </SelectContent>
          </Select>

          {g.modo === 'existente' ? (
            elegibles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {customerId ? 'Este cliente no tiene motos liberadas o vendidas en esta sucursal.' : 'Elige primero el cliente.'}
              </p>
            ) : (
              <Select value={g.vehicleId} onValueChange={(v) => set('vehicleId', v)}>
                <SelectTrigger aria-label="Moto del cliente"><SelectValue placeholder="Elige la moto" /></SelectTrigger>
                <SelectContent>
                  {elegibles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {vehicleLabel(v)} · {v.chassis ?? 'sin chasis'} · {VEHICLE_STATUS[v.status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Tipo de vehículo</Label>
                <Select value={g.vehicleTypeId} onValueChange={(v) => set('vehicleTypeId', v)}>
                  <SelectTrigger aria-label="Tipo de vehículo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_TIPO}>Sin tipo</SelectItem>
                    {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {campo('brand', 'Marca', { placeholder: 'Honda' })}
              {campo('model', 'Modelo', { placeholder: 'C70' })}
              {campo('year', 'Año', { inputMode: 'numeric', placeholder: '2020' })}
              {campo('color', 'Color')}
              {campo('chassis', 'Chasis *')}
              {campo('engineNumber', 'Número de motor')}
              {campo('plate', 'Placa')}
              {campo('registrationNumber', 'Número de matrícula')}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="gar-custodia">La matrícula queda en custodia</Label>
            <Switch id="gar-custodia" checked={g.custodia} onCheckedChange={(v) => set('custodia', v)} />
          </div>
          {g.custodia && (
            <div className="grid gap-1.5">
              <Label htmlFor="gar-ubicacion">Dónde se guarda</Label>
              <Input id="gar-ubicacion" value={g.ubicacion} placeholder="Gaveta 2, archivo A…"
                onChange={(e) => set('ubicacion', e.target.value)} />
            </div>
          )}
          {falta && <p className="text-xs text-destructive">{falta}</p>}
        </>
      )}
    </div>
  );
}
