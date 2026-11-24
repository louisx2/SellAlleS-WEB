'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { Product, Vehicle, VehicleType } from '@/lib/types';
import type { NewVehicleInput, VehiclePatch } from '@/hooks/use-vehiculos';
import { parseMonto } from '@/lib/motos';

const SIN_TIPO = 'sin-tipo';

type Form = {
  productId: string;
  vehicleTypeId: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  chassis: string;
  engineNumber: string;
  plate: string;
  registrationNumber: string;
  cc: string;
  condition: 'nuevo' | 'usado';
  cost: string;
  price: string;
  notes: string;
  extra: Record<string, string>;
};

const vacio = (productId = ''): Form => ({
  productId, vehicleTypeId: SIN_TIPO, brand: '', model: '', year: '', color: '', chassis: '', engineNumber: '',
  plate: '', registrationNumber: '', cc: '', condition: 'nuevo', cost: '', price: '', notes: '', extra: {},
});

const desde = (v: Vehicle): Form => ({
  productId: v.productId ?? '',
  vehicleTypeId: v.vehicleTypeId ?? SIN_TIPO,
  brand: v.brand ?? '', model: v.model ?? '', year: v.year ? String(v.year) : '', color: v.color ?? '',
  chassis: v.chassis ?? '', engineNumber: v.engineNumber ?? '', plate: v.plate ?? '',
  registrationNumber: v.registrationNumber ?? '', cc: v.cc ?? '', condition: v.condition,
  cost: v.cost != null ? String(v.cost) : '', price: v.price != null ? String(v.price) : '',
  notes: v.notes ?? '',
  extra: Object.fromEntries(Object.entries(v.extra ?? {}).map(([k, x]) => [k, String(x)])),
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin vehículo = ingresar unidad nueva. */
  vehicle?: Vehicle;
  /** Artículo con el que abrir (desde el inventario). */
  defaultProductId?: string;
  branchId?: string;
  types: VehicleType[];
  /** Artículos marcados como vehículo en la sucursal. */
  vehicleProducts: Product[];
  onCreate: (input: NewVehicleInput) => Promise<unknown>;
  onUpdate: (id: string, patch: VehiclePatch) => Promise<unknown>;
}

// Ingresar o editar una unidad de inventario. El estado, la venta y el dueño los
// pone la base: aquí solo los datos de la moto.
export function VehicleFormDialog({
  open, onOpenChange, vehicle, defaultProductId, branchId, types, vehicleProducts, onCreate, onUpdate,
}: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(vacio());
  const [saving, setSaving] = useState(false);
  const editando = !!vehicle;

  useEffect(() => {
    if (!open) return;
    if (vehicle) { setForm(desde(vehicle)); return; }
    const pid = defaultProductId ?? (vehicleProducts.length === 1 ? vehicleProducts[0].id : '');
    const prod = vehicleProducts.find((p) => p.id === pid);
    setForm({ ...vacio(pid), cost: prod ? String(prod.cost) : '' });
  }, [open, vehicle, defaultProductId, vehicleProducts]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const tipo = types.find((t) => t.id === form.vehicleTypeId);
  const activos = types.filter((t) => t.isActive || t.id === form.vehicleTypeId);

  const guardar = async () => {
    if (!editando && !form.productId) {
      toast({ title: 'Elige el artículo', description: 'La unidad tiene que ser de un artículo marcado como vehículo.', variant: 'destructive' });
      return;
    }
    if (!form.chassis.trim()) {
      toast({ title: 'Falta el chasis', description: 'Cada unidad se identifica por su número de chasis.', variant: 'destructive' });
      return;
    }
    const year = form.year.trim() ? Number(form.year) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1950 || year > 2100)) {
      toast({ title: 'Año inválido', variant: 'destructive' });
      return;
    }
    // "95,000" vale; lo que no sea un monto se avisa en vez de guardarse vacío.
    const cost = parseMonto(form.cost);
    const price = parseMonto(form.price);
    const malo = Number.isNaN(cost) ? 'Costo de la unidad' : Number.isNaN(price) ? 'Precio propio' : null;
    if (malo) {
      toast({ title: `${malo}: monto inválido`, description: 'Escribe solo el número, por ejemplo 95,000 o 95000.', variant: 'destructive' });
      return;
    }
    const extra: Record<string, string | number> = {};
    for (const f of tipo?.extraFields ?? []) {
      const val = (form.extra[f.key] ?? '').trim();
      if (!val) continue;
      if (f.type === 'number') {
        const n = parseMonto(val);
        if (n === undefined || Number.isNaN(n)) {
          toast({ title: `${f.label}: número inválido`, variant: 'destructive' });
          return;
        }
        extra[f.key] = n;
      } else {
        extra[f.key] = val;
      }
    }
    const datos: VehiclePatch = {
      vehicleTypeId: form.vehicleTypeId === SIN_TIPO ? '' : form.vehicleTypeId,
      brand: form.brand, model: form.model, year, color: form.color, chassis: form.chassis,
      engineNumber: form.engineNumber, plate: form.plate, registrationNumber: form.registrationNumber, cc: form.cc,
      condition: form.condition, cost, price, notes: form.notes, extra,
    };
    setSaving(true);
    try {
      if (vehicle) await onUpdate(vehicle.id, datos);
      else await onCreate({ ...datos, branchId: branchId ?? '', origin: 'inventario', productId: form.productId });
      toast({ title: editando ? 'Vehículo actualizado' : 'Unidad ingresada', description: form.chassis.trim() });
      onOpenChange(false);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      toast({
        title: 'No se pudo guardar',
        description: msg.includes('vehicles_chassis_uq') ? 'Ya hay otro vehículo con ese chasis.' : msg || 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const campo = (id: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`veh-${id}`}>{label}</Label>
      <Input id={`veh-${id}`} value={form[id] as string} onChange={(e) => set(id, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar vehículo' : 'Ingresar unidad'}</DialogTitle>
          <DialogDescription>
            {editando ? 'Datos de la unidad. El estado y la venta los cambia el sistema.' : 'Cada moto entra con su chasis y suma una unidad a las existencias del artículo.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {!editando && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Artículo</Label>
              <Select value={form.productId} onValueChange={(v) => {
                const prod = vehicleProducts.find((p) => p.id === v);
                setForm((f) => ({ ...f, productId: v, cost: f.cost || (prod ? String(prod.cost) : '') }));
              }}>
                <SelectTrigger><SelectValue placeholder="Elige el modelo (artículo marcado como vehículo)" /></SelectTrigger>
                <SelectContent>
                  {vehicleProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Tipo de vehículo</Label>
            <Select value={form.vehicleTypeId} onValueChange={(v) => set('vehicleTypeId', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_TIPO}>Sin tipo</SelectItem>
                {activos.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Condición</Label>
            <Select value={form.condition} onValueChange={(v) => set('condition', v as Form['condition'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nuevo">Nuevo</SelectItem>
                <SelectItem value="usado">Usado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {campo('brand', 'Marca', { placeholder: 'Honda' })}
          {campo('model', 'Modelo', { placeholder: 'CG 150' })}
          {campo('year', 'Año', { inputMode: 'numeric', placeholder: '2025' })}
          {campo('color', 'Color')}
          {campo('chassis', 'Chasis', { required: true })}
          {campo('engineNumber', 'Número de motor')}
          {campo('plate', 'Placa')}
          {campo('registrationNumber', 'Número de matrícula')}
          {campo('cc', 'Cilindraje')}
          {(tipo?.extraFields ?? []).map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`veh-extra-${f.key}`}>{f.label}</Label>
              <Input
                id={`veh-extra-${f.key}`} inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={form.extra[f.key] ?? ''}
                onChange={(e) => setForm((x) => ({ ...x, extra: { ...x.extra, [f.key]: e.target.value } }))}
              />
            </div>
          ))}
          {campo('cost', 'Costo de la unidad (RD$)', { inputMode: 'decimal' })}
          {campo('price', 'Precio propio (opcional)', { inputMode: 'decimal', placeholder: 'Vacío = el del artículo' })}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="veh-notes">Notas</Label>
            <Textarea id="veh-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : editando ? 'Guardar' : 'Ingresar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
