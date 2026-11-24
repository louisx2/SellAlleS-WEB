'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { useSaldosDeVehiculos } from '@/hooks/use-saldos-de-vehiculos';
import { usePermission } from '@/hooks/use-permission';
import { formatCurrency } from '@/lib/utils';
import { deudaDelVehiculo, diasDesde, matchesVehicle, matriculasPorPestana, vehicleLabel } from '@/lib/motos';
import { EntregarMatriculaDialog } from '@/components/motos/entregar-matricula-dialog';
import type { Vehicle } from '@/lib/types';

type Pestana = 'enCustodia' | 'listas' | 'entregadas';

const PESTANAS: { key: Pestana; label: string }[] = [
  { key: 'enCustodia', label: 'En custodia' },
  { key: 'listas', label: 'Listas para entregar' },
  { key: 'entregadas', label: 'Entregadas' },
];

const fecha = (d?: Date) => (d ? d.toLocaleDateString('es-DO') : '—');

// Matrículas que guarda el negocio mientras la moto se paga, las que ya se
// pueden entregar y las entregadas. De la sucursal activa.
export default function MatriculasPage() {
  const { vehicles, loading, entregarMatricula } = useVehiculos();
  const { ventas, prestamos } = useSaldosDeVehiculos();
  const canEdit = usePermission('motos', 'edit');
  const [pestana, setPestana] = useState<Pestana>('enCustodia');
  const [q, setQ] = useState('');
  const [entregarId, setEntregarId] = useState<string | null>(null);
  const hoy = new Date();

  const grupos = useMemo(() => matriculasPorPestana(vehicles), [vehicles]);
  const filas = useMemo(() => grupos[pestana].filter((v) => matchesVehicle(v, q)), [grupos, pestana, q]);
  // Se busca en la lista recargada: tras entregar, el diálogo ve los datos guardados.
  const elegido = vehicles.find((v) => v.id === entregarId) ?? null;

  const cuenta = (v: Vehicle) => {
    const d = deudaDelVehiculo(v, ventas, prestamos);
    const enlace = (v.status === 'en_garantia' || v.status === 'liberado') && v.loanId
      ? `/prestamos/detalle?id=${v.loanId}`
      : v.saleId ? `/sales/detail?id=${v.saleId}` : null;
    return (
      <span className="whitespace-nowrap">
        {d ? formatCurrency(d.pendiente) : '—'}
        {d?.atrasado && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-900/60 dark:text-red-100">Atrasado</span>}
        {enlace && <Link href={enlace} className="ml-2 text-xs underline underline-offset-2" onClick={(e) => e.stopPropagation()}>ver</Link>}
      </span>
    );
  };

  return (
    <div>
      <PageHeader title="Matrículas" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={pestana} onValueChange={(v) => setPestana(v as Pestana)}>
          <TabsList className="h-auto flex-wrap">
            {PESTANAS.map((p) => (
              <TabsTrigger key={p.key} value={p.key}>{p.label} ({grupos[p.key].length})</TabsTrigger>
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
                  <TableHead>Moto</TableHead>
                  <TableHead>Chasis</TableHead>
                  <TableHead>Cliente</TableHead>
                  {pestana === 'entregadas' ? (
                    <>
                      <TableHead>Retiró</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Entregó</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Saldo</TableHead>
                      <TableHead>Guardada en</TableHead>
                      <TableHead>{pestana === 'listas' ? 'Lista desde' : 'En custodia desde'}</TableHead>
                    </>
                  )}
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length > 0 ? filas.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      <Link href={`/motos/ficha?id=${v.id}`} className="hover:underline">{vehicleLabel(v)}</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{v.chassis ?? '—'}</TableCell>
                    <TableCell>{v.customerName ?? '—'}</TableCell>
                    {pestana === 'entregadas' ? (
                      <>
                        <TableCell>{v.registrationDeliveredTo ?? '—'}{v.registrationDeliveredDoc ? ` · ${v.registrationDeliveredDoc}` : ''}</TableCell>
                        <TableCell>{fecha(v.registrationDeliveredAt)}</TableCell>
                        <TableCell>{v.registrationDeliveredByName ?? '—'}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{cuenta(v)}</TableCell>
                        <TableCell>{v.registrationLocation ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {fecha(v.registrationSince)}
                          {pestana === 'listas' && v.registrationSince ? ` · ${diasDesde(v.registrationSince, hoy)} días` : ''}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setEntregarId(v.id)}>
                          {pestana === 'entregadas' ? 'Constancia' : 'Entregar'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {loading ? 'Cargando…' : 'No hay matrículas aquí.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EntregarMatriculaDialog
        vehicle={elegido}
        open={!!entregarId}
        onOpenChange={(o) => { if (!o) setEntregarId(null); }}
        onEntregar={entregarMatricula}
      />
    </div>
  );
}
