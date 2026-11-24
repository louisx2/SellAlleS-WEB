'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Search } from 'lucide-react';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { useProducts } from '@/context/product-provider';
import { usePermission } from '@/hooks/use-permission';
import { formatCurrency } from '@/lib/utils';
import { matchesVehicle, vehicleLabel, type VehicleStatus } from '@/lib/motos';
import { VehicleStatusBadge, RegistrationText } from '@/components/motos/vehicle-status-badge';
import { VehicleFormDialog } from '@/components/motos/vehicle-form-dialog';

type Pestana = 'disponible' | 'vendido' | 'en_garantia' | 'todos';

const PESTANAS: { key: Pestana; label: string }[] = [
  { key: 'disponible', label: 'Disponibles' },
  { key: 'vendido', label: 'Vendidos' },
  { key: 'en_garantia', label: 'En garantía' },
  { key: 'todos', label: 'Todos' },
];

export default function VehiculosPage() {
  const router = useRouter();
  const { branchId, vehicles, types, loading, addVehicle, updateVehicle } = useVehiculos();
  const { products } = useProducts();
  const canCreate = usePermission('motos', 'create');
  const [pestana, setPestana] = useState<Pestana>('disponible');
  const [q, setQ] = useState('');
  const [ingresar, setIngresar] = useState(false);

  const vehicleProducts = useMemo(() => products.filter((p) => p.isVehicle), [products]);

  const cuenta = (s: VehicleStatus) => vehicles.filter((v) => v.status === s).length;
  const filas = useMemo(
    () => vehicles
      .filter((v) => pestana === 'todos' || v.status === pestana)
      .filter((v) => matchesVehicle(v, q)),
    [vehicles, pestana, q],
  );

  return (
    <div>
      <PageHeader title="Vehículos">
        {canCreate && (
          <Button onClick={() => setIngresar(true)} disabled={vehicleProducts.length === 0}>
            <PlusCircle className="mr-2 h-4 w-4" /> Ingresar unidad
          </Button>
        )}
      </PageHeader>

      {canCreate && !loading && vehicleProducts.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          Para ingresar motos, marca primero el artículo (el modelo) como vehículo en Inventario.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={pestana} onValueChange={(v) => setPestana(v as Pestana)}>
          <TabsList>
            {PESTANAS.map((p) => (
              <TabsTrigger key={p.key} value={p.key}>
                {p.label}{p.key !== 'todos' ? ` (${cuenta(p.key)})` : ''}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Chasis, placa, modelo o cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Chasis</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Matrícula</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length > 0 ? filas.map((v) => (
                  <TableRow key={v.id} className="cursor-pointer" onClick={() => router.push(`/motos/ficha?id=${v.id}`)}>
                    <TableCell className="font-medium">{vehicleLabel(v)}</TableCell>
                    <TableCell className="font-mono text-xs">{v.chassis ?? '—'}</TableCell>
                    <TableCell>{v.plate ?? '—'}</TableCell>
                    <TableCell><VehicleStatusBadge status={v.status} /></TableCell>
                    <TableCell>{v.customerName ?? '—'}</TableCell>
                    <TableCell><RegistrationText status={v.registrationStatus} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {v.origin === 'inventario' ? formatCurrency(v.price ?? v.productPrice ?? 0) : '—'}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {loading ? 'Cargando…' : 'No hay vehículos aquí.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <VehicleFormDialog
        open={ingresar}
        onOpenChange={setIngresar}
        branchId={branchId}
        types={types}
        vehicleProducts={vehicleProducts}
        onCreate={addVehicle}
        onUpdate={updateVehicle}
      />
    </div>
  );
}
