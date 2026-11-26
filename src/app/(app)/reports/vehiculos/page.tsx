'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { Bike, HandCoins, ShieldCheck } from 'lucide-react';
import { useVehiculos } from '@/hooks/use-vehiculos';
import { useSales } from '@/context/sales-provider';
import { useSaldosDeVehiculos } from '@/hooks/use-saldos-de-vehiculos';
import { formatCurrency } from '@/lib/utils';
import { diasDesde, matriculasPorPestana, reporteDeMatriculas, VEHICLE_STATUS, vehicleLabel, type VehicleStatus } from '@/lib/motos';
import { carteraDeVehiculos, ventasDeVehiculos } from '@/lib/motos-reportes';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Vehículos de la sucursal activa: cuántos hay en cada estado, cuánto vale el
// inventario, lo que falta por cobrar de los vendidos a cuotas y de los préstamos
// con la moto en garantía, las ventas del período por modelo y las matrículas.
export default function ReporteVehiculosPage() {
  const { vehicles, loading } = useVehiculos();
  const { sales } = useSales();
  const saldos = useSaldosDeVehiculos();
  const hoy = new Date();
  const [desde, setDesde] = useState(ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [hasta, setHasta] = useState(ymd(hoy));

  const cartera = useMemo(
    () => carteraDeVehiculos(vehicles, saldos.ventas, saldos.prestamos),
    [vehicles, saldos.ventas, saldos.prestamos],
  );

  const matriculas = useMemo(() => {
    const ahora = new Date();
    return {
      resumen: reporteDeMatriculas(vehicles, new Date(`${desde}T00:00:00`), new Date(`${hasta}T23:59:59`), ahora),
      listas: matriculasPorPestana(vehicles).listas.map((v) => ({
        v, dias: v.registrationSince ? diasDesde(v.registrationSince, ahora) : 0,
      })),
    };
  }, [vehicles, desde, hasta]);

  const ventas = useMemo(() => {
    const lista = sales.filter((s) => !s.cancelledAt).map((s) => ({
      id: s.id,
      createdAt: new Date(s.createdAt),
      paymentMethod: s.paymentMethod,
      downPayment: s.financingDetails?.downPayment,
      installments: s.financingDetails?.installments,
      frequency: s.financingDetails?.frequency,
    }));
    return ventasDeVehiculos(vehicles, lista, new Date(`${desde}T00:00:00`), new Date(`${hasta}T23:59:59`));
  }, [vehicles, sales, desde, hasta]);

  const tarjeta = (titulo: string, icono: React.ReactNode, valor: string, nota: string) => (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{titulo}</CardTitle>{icono}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{valor}</div>
        <p className="text-xs text-muted-foreground">{nota}</p>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Vehículos">
        <ExportButton
          filename="ventas_de_vehiculos"
          rows={ventas.porModelo}
          columns={[
            { header: 'Modelo', value: (r) => r.modelo },
            { header: 'Contado', value: (r) => r.contado },
            { header: 'Financiado', value: (r) => r.financiado },
          ]}
        />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {tarjeta('En inventario', <Bike className="h-4 w-4 text-muted-foreground" />,
          String(cartera.porEstado.disponible), `${formatCurrency(cartera.inventarioACosto)} a costo`)}
        {tarjeta('Vendidas a cuotas', <HandCoins className="h-4 w-4 text-muted-foreground" />,
          formatCurrency(cartera.vendidosACuotas.pendiente),
          `${cartera.vendidosACuotas.cantidad} con saldo · ${cartera.vendidosACuotas.atrasados} atrasadas`)}
        {tarjeta('Préstamos con garantía', <ShieldCheck className="h-4 w-4 text-muted-foreground" />,
          formatCurrency(cartera.prestamosConGarantia.pendiente),
          `${cartera.prestamosConGarantia.cantidad} con saldo · ${cartera.prestamosConGarantia.atrasados} atrasados · ${cartera.porEstado.en_garantia} motos`)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Por estado</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((s) => (
                  <TableRow key={s}>
                    <TableCell>{VEHICLE_STATUS[s].label}</TableCell>
                    <TableCell className="text-right font-semibold">{loading ? '…' : cartera.porEstado[s]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
            <CardTitle>Ventas del período</CardTitle>
            <div className="flex gap-2">
              <div className="grid gap-1"><Label htmlFor="veh-desde" className="text-xs">Desde</Label>
                <Input id="veh-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="veh-hasta" className="text-xs">Hasta</Label>
                <Input id="veh-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">De contado</p><p className="text-lg font-semibold">{ventas.contado}</p></div>
              <div><p className="text-xs text-muted-foreground">Financiadas</p><p className="text-lg font-semibold">{ventas.financiado}</p></div>
              <div><p className="text-xs text-muted-foreground">Inicial promedio</p><p className="text-lg font-semibold">{formatCurrency(ventas.inicialPromedio)}</p></div>
              <div><p className="text-xs text-muted-foreground">Cuotas promedio</p><p className="text-lg font-semibold">{ventas.plazoPromedio}</p></div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Financiado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventas.porModelo.length > 0 ? ventas.porModelo.map((r) => (
                  <TableRow key={r.modelo}>
                    <TableCell className="font-medium">{r.modelo}</TableCell>
                    <TableCell className="text-right">{r.contado}</TableCell>
                    <TableCell className="text-right">{r.financiado}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">No se vendieron vehículos en el período.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <CardTitle>Matrículas</CardTitle>
          <ExportButton
            filename="matriculas_listas_para_entregar"
            rows={matriculas.listas}
            columns={[
              { header: 'Moto', value: (r) => vehicleLabel(r.v) },
              { header: 'Chasis', value: (r) => r.v.chassis ?? '' },
              { header: 'Cliente', value: (r) => r.v.customerName ?? '' },
              { header: 'Guardada en', value: (r) => r.v.registrationLocation ?? '' },
              { header: 'Días esperando', value: (r) => r.dias },
            ]}
          />
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">En custodia</p><p className="text-lg font-semibold">{matriculas.resumen.enCustodia}</p></div>
            <div><p className="text-xs text-muted-foreground">Listas para entregar</p><p className="text-lg font-semibold">{matriculas.resumen.listas}</p></div>
            <div><p className="text-xs text-muted-foreground">Listas hace más de 30 días</p><p className="text-lg font-semibold">{matriculas.resumen.listasMasDe30}</p></div>
            <div><p className="text-xs text-muted-foreground">Entregadas en el período</p><p className="text-lg font-semibold">{matriculas.resumen.entregadasEnPeriodo}</p></div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lista para entregar</TableHead>
                <TableHead>Chasis</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Guardada en</TableHead>
                <TableHead className="text-right">Días esperando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matriculas.listas.length > 0 ? matriculas.listas.map(({ v, dias }) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{vehicleLabel(v)}</TableCell>
                  <TableCell className="font-mono text-xs">{v.chassis ?? '—'}</TableCell>
                  <TableCell>{v.customerName ?? '—'}</TableCell>
                  <TableCell>{v.registrationLocation ?? '—'}</TableCell>
                  <TableCell className="text-right">{dias}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No hay matrículas esperando a su dueño.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
