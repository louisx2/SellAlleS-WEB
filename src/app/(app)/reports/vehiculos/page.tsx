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
import { useCompanyProfile } from '@/context/company-profile-provider';
import { calculateFinancingStatus, formatCurrency } from '@/lib/utils';
import { VEHICLE_STATUS, type VehicleStatus } from '@/lib/motos';
import { carteraDeVehiculos, ventasDeVehiculos } from '@/lib/motos-reportes';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Vehículos de la sucursal activa: cuántos hay en cada estado, cuánto vale el
// inventario, lo que falta por cobrar de los vendidos a cuotas, y las ventas del
// período por modelo.
export default function ReporteVehiculosPage() {
  const { vehicles, loading } = useVehiculos();
  const { sales, financingSales } = useSales();
  const { profile } = useCompanyProfile();
  const hoy = new Date();
  const [desde, setDesde] = useState(ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [hasta, setHasta] = useState(ymd(hoy));

  const cartera = useMemo(() => {
    const saldos = new Map(financingSales.filter((s) => !s.cancelledAt).map((s) => {
      const st = calculateFinancingStatus(s, profile.lateFeeRate, profile.lateFeeGraceDays);
      return [s.id, { pendiente: st.pendingBalance, atrasado: st.isOverdue }];
    }));
    return carteraDeVehiculos(vehicles, saldos);
  }, [vehicles, financingSales, profile.lateFeeRate, profile.lateFeeGraceDays]);

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
        {tarjeta('En garantía', <ShieldCheck className="h-4 w-4 text-muted-foreground" />,
          String(cartera.porEstado.en_garantia), 'motos de clientes en préstamos')}
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
    </div>
  );
}
