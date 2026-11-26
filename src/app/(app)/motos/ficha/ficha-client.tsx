'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Pencil, Ban } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { useProducts } from '@/context/product-provider';
import { fetchVehicle, fetchVehicleEvents, useVehiculos } from '@/hooks/use-vehiculos';
import { formatCurrency } from '@/lib/utils';
import { REGISTRATION_STATUS_LABEL, VEHICLE_STATUS, vehicleLabel, type VehicleStatus } from '@/lib/motos';
import { VehicleStatusBadge } from '@/components/motos/vehicle-status-badge';
import { VehicleFormDialog } from '@/components/motos/vehicle-form-dialog';
import type { Vehicle, VehicleEvent } from '@/lib/types';

const EVENTO: Record<VehicleEvent['kind'], string> = {
  ingreso: 'Ingresó',
  venta: 'Vendido',
  venta_anulada: 'Venta anulada',
  cambio_estado: 'Cambio de estado',
  matricula: 'Matrícula',
  edicion: 'Editado',
  baja: 'Dado de baja',
};

const estado = (s?: string) =>
  (s && (VEHICLE_STATUS as Record<string, { label: string }>)[s]?.label)
  || (s && (REGISTRATION_STATUS_LABEL as Record<string, string>)[s])
  || s || '';

export default function FichaVehiculoClient() {
  const { toast } = useToast();
  const [id, setId] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [eventos, setEventos] = useState<VehicleEvent[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editar, setEditar] = useState(false);
  const [baja, setBaja] = useState(false);
  const [motivo, setMotivo] = useState('');
  const canEdit = usePermission('motos', 'edit');
  const { products } = useProducts();
  const { types, updateVehicle, darDeBaja } = useVehiculos({ branchId: vehicle?.branchId });

  useEffect(() => {
    if (typeof window !== 'undefined') setId(new URLSearchParams(window.location.search).get('id') ?? '');
  }, []);

  const cargar = useCallback(async () => {
    if (!id) return;
    setCargando(true);
    const [v, e] = await Promise.all([fetchVehicle(id), fetchVehicleEvents(id).catch(() => [])]);
    setVehicle(v);
    setEventos(e);
    setCargando(false);
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const vehicleProducts = useMemo(() => products.filter((p) => p.isVehicle), [products]);

  const confirmarBaja = async () => {
    if (!vehicle || !motivo.trim()) return;
    try {
      await darDeBaja(vehicle, motivo);
      toast({ title: 'Vehículo dado de baja' });
      setBaja(false);
      setMotivo('');
      await cargar();
    } catch (e: any) {
      toast({ title: 'No se pudo dar de baja', description: e?.message, variant: 'destructive' });
    }
  };

  if (cargando) return <p className="text-muted-foreground">Cargando…</p>;
  if (!vehicle) return <p className="text-muted-foreground">No se encontró el vehículo.</p>;

  const dato = (label: string, valor?: React.ReactNode) => (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{valor || '—'}</p>
    </div>
  );
  const extra = Object.entries(vehicle.extra ?? {});
  const tipo = types.find((t) => t.id === vehicle.vehicleTypeId);

  return (
    <div>
      <PageHeader title={vehicleLabel(vehicle)}>
        <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/motos"><ArrowLeft className="mr-2 h-4 w-4" /> Vehículos</Link>
        </Button>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditar(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </Button>
        )}
        {canEdit && vehicle.status === 'disponible' && (
          <Button variant="outline" onClick={() => setBaja(true)}>
            <Ban className="mr-2 h-4 w-4" /> Dar de baja
          </Button>
        )}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Datos</CardTitle>
            <VehicleStatusBadge status={vehicle.status as VehicleStatus} />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            {dato('Chasis', <span className="font-mono">{vehicle.chassis}</span>)}
            {dato('Motor', vehicle.engineNumber)}
            {dato('Placa', vehicle.plate)}
            {dato('Matrícula (número)', vehicle.registrationNumber)}
            {dato('Cilindraje', vehicle.cc)}
            {dato('Condición', vehicle.condition === 'usado' ? 'Usado' : 'Nuevo')}
            {dato('Tipo', tipo?.name)}
            {dato('Artículo', vehicle.productName)}
            {vehicle.origin === 'inventario' && dato('Costo', vehicle.cost != null ? formatCurrency(vehicle.cost) : undefined)}
            {vehicle.origin === 'inventario' && dato('Precio', formatCurrency(vehicle.price ?? vehicle.productPrice ?? 0))}
            {extra.map(([k, v]) => dato(tipo?.extraFields.find((f) => f.key === k)?.label ?? k, String(v)))}
            {vehicle.notes && (
              <div className="col-span-full">
                <p className="text-xs text-muted-foreground">Notas</p>
                <p className="whitespace-pre-line">{vehicle.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cliente y matrícula</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {dato('Cliente', vehicle.customerName && (
              <span>{vehicle.customerName}{vehicle.customerPhone ? ` · ${vehicle.customerPhone}` : ''}</span>
            ))}
            {vehicle.saleId && dato('Venta', (
              <Link href={`/sales/detail?id=${vehicle.saleId}`} className="underline underline-offset-2">Ver la venta</Link>
            ))}
            {dato('Matrícula', REGISTRATION_STATUS_LABEL[vehicle.registrationStatus])}
            {vehicle.registrationSince && dato('Desde', vehicle.registrationSince.toLocaleDateString('es-DO'))}
            {vehicle.registrationLocation && dato('Guardada en', vehicle.registrationLocation)}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
          <CardContent>
            {eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {eventos.map((e) => (
                  <li key={e.id} className="flex flex-col border-b pb-2 last:border-0 sm:flex-row sm:justify-between">
                    <span>
                      <span className="font-medium">{EVENTO[e.kind]}</span>
                      {e.fromStatus || e.toStatus ? ` · ${estado(e.fromStatus)}${e.fromStatus ? ' → ' : ''}${estado(e.toStatus)}` : ''}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {e.createdAt.toLocaleString('es-DO')}{e.createdByName ? ` · ${e.createdByName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <VehicleFormDialog
        open={editar}
        onOpenChange={(o) => { setEditar(o); if (!o) cargar(); }}
        vehicle={vehicle}
        types={types}
        vehicleProducts={vehicleProducts}
        onCreate={async () => undefined}
        onUpdate={updateVehicle}
      />

      <Dialog open={baja} onOpenChange={setBaja}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar de baja</DialogTitle>
            <DialogDescription>La unidad sale de las existencias. El chasis queda libre para volver a registrarse.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="baja-motivo">Motivo</Label>
            <Textarea id="baja-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Robada, devuelta al suplidor, error de registro…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBaja(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarBaja} disabled={!motivo.trim()}>Dar de baja</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
