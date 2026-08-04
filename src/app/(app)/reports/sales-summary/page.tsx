'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatCurrency } from '@/lib/utils';
import {
  Calendar as CalendarIcon, DollarSign, Hash, Receipt, Loader2,
  Package, Users2, TicketPercent, Ban, Store, Wallet,
} from 'lucide-react';
import { SalesChart } from '@/components/reports/sales-chart';
import { RecentSales } from '@/components/reports/recent-sales';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToSale } from '@/lib/supabase/mappers';
import type { Sale } from '@/lib/types';
import { ExportButton } from '@/components/reports/export-button';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  financing: 'Financiamiento',
};
const METHODS = Object.keys(METHOD_LABEL);

const STATUS_LABEL: Record<string, string> = {
  paid: 'Pagada',
  credit: 'A crédito',
  in_financing: 'Financiada',
};

const SALE_SELECT = '*, sale_items(*), customers(*), branches(name), financing_installments(*)';

const cantidad = (n: number) => n.toLocaleString('es-DO', { maximumFractionDigits: 2 });

export default function SalesSummaryReportPage() {
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [todas, setTodas] = React.useState<Sale[]>([]);
  const [loading, setLoading] = React.useState(true);

  const esAdmin = appUser?.role === 'admin';

  React.useEffect(() => {
    if (!esAdmin && appUser?.activeBranchId) setSelectedBranch(appUser.activeBranchId);
  }, [esAdmin, appUser?.activeBranchId]);

  const desde = date?.from;
  const hasta = date?.to ?? date?.from;
  const desdeIso = React.useMemo(() => {
    if (!desde) return null;
    const d = new Date(desde);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [desde]);
  const hastaIso = React.useMemo(() => {
    if (!hasta) return null;
    const d = new Date(hasta);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [hasta]);

  // Consulta propia en vez del provider de ventas: ese solo carga la sucursal
  // activa, y aquí el admin filtra por cualquiera (o por todas).
  React.useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      if (!desdeIso || !hastaIso) return;
      setLoading(true);
      let q = supabase
        .from('sales')
        .select(SALE_SELECT)
        .gte('created_at', desdeIso)
        .lte('created_at', hastaIso)
        .order('created_at', { ascending: false });
      if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (cancelado) return;
      setTodas(error || !data ? [] : data.map(rowToSale));
      setLoading(false);
    };
    cargar();
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, selectedBranch]);

  // Las anuladas no cuentan como ingreso, pero sí se informan aparte.
  const ventas = React.useMemo(() => todas.filter((s) => !s.cancelledAt), [todas]);
  const anuladas = React.useMemo(() => todas.filter((s) => s.cancelledAt), [todas]);

  const kpis = React.useMemo(() => {
    let ingresos = 0, itbis = 0, subtotal = 0, articulos = 0, descuentos = 0;
    const clientes = new Set<string>();
    ventas.forEach((s) => {
      ingresos += s.total;
      itbis += s.itbisAmount;
      subtotal += s.subtotal;
      if (s.customerId) clientes.add(s.customerId);
      s.items.forEach((it) => {
        articulos += it.quantity;
        // `product.price` es el precio de lista que quedó grabado en la línea;
        // `customPrice`, lo que se cobró de verdad si en caja se rebajó.
        const lista = it.product.price;
        const cobrado = it.customPrice ?? lista;
        if (cobrado < lista) descuentos += (lista - cobrado) * it.quantity;
      });
    });
    return {
      ingresos, itbis, subtotal, articulos, descuentos,
      clientes: clientes.size,
      ventas: ventas.length,
      ticket: ventas.length > 0 ? ingresos / ventas.length : 0,
      anuladas: anuladas.length,
      montoAnulado: anuladas.reduce((a, s) => a + s.total, 0),
    };
  }, [ventas, anuladas]);

  const porDia = React.useMemo(() => {
    const map = new Map<string, number>();
    ventas.forEach((s) => {
      const clave = format(s.createdAt, 'yyyy-MM-dd');
      map.set(clave, (map.get(clave) ?? 0) + s.total);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clave, total]) => ({
        name: format(new Date(`${clave}T12:00:00`), 'd LLL', { locale: es }),
        total,
      }));
  }, [ventas]);

  const porMetodo = React.useMemo(() => {
    const map = new Map<string, { ventas: number; monto: number }>();
    ventas.forEach((s) => {
      const m = s.paymentMethod ?? '';
      const acc = map.get(m) ?? { ventas: 0, monto: 0 };
      map.set(m, { ventas: acc.ventas + 1, monto: acc.monto + s.total });
    });
    return METHODS
      .map((m) => ({ metodo: m, ...(map.get(m) ?? { ventas: 0, monto: 0 }) }))
      .filter((f) => f.ventas > 0);
  }, [ventas]);

  const porEstado = React.useMemo(() => {
    const map = new Map<string, { ventas: number; monto: number }>();
    ventas.forEach((s) => {
      const e = s.paymentStatus ?? '';
      const acc = map.get(e) ?? { ventas: 0, monto: 0 };
      map.set(e, { ventas: acc.ventas + 1, monto: acc.monto + s.total });
    });
    return Object.keys(STATUS_LABEL)
      .map((e) => ({ estado: e, ...(map.get(e) ?? { ventas: 0, monto: 0 }) }))
      .filter((f) => f.ventas > 0);
  }, [ventas]);

  const porSucursal = React.useMemo(() => {
    const map = new Map<string, { ventas: number; monto: number }>();
    ventas.forEach((s) => {
      const b = s.branchId || 'Sin sucursal';
      const acc = map.get(b) ?? { ventas: 0, monto: 0 };
      map.set(b, { ventas: acc.ventas + 1, monto: acc.monto + s.total });
    });
    return Array.from(map.entries())
      .map(([sucursal, d]) => ({ sucursal, ...d }))
      .sort((a, b) => b.monto - a.monto);
  }, [ventas]);

  const pct = (monto: number) => (kpis.ingresos > 0 ? (monto / kpis.ingresos) * 100 : 0);

  return (
    <div>
      <PageHeader title="Resumen de Ventas">
        <div className="flex flex-wrap items-center gap-2">
          {esAdmin && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-[260px] justify-start text-left font-normal', !date && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'd LLL y', { locale: es })} – {format(date.to, 'd LLL y', { locale: es })}
                    </>
                  ) : (
                    format(date.from, 'd LLL y', { locale: es })
                  )
                ) : (
                  <span>Elige un rango</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={es}
              />
            </PopoverContent>
          </Popover>

          <ExportButton
            filename="resumen_ventas"
            rows={todas}
            columns={[
              { header: 'Fecha', value: (s) => s.createdAt.toLocaleString('es-DO') },
              { header: 'Sucursal', value: (s) => s.branchId },
              { header: 'Usuario', value: (s) => s.userName ?? '' },
              { header: 'Cliente', value: (s) => s.customer?.name ?? '' },
              { header: 'NCF', value: (s) => s.ncf ?? '' },
              { header: 'Articulos', value: (s) => s.items.reduce((a, i) => a + i.quantity, 0) },
              { header: 'Subtotal', value: (s) => s.subtotal },
              { header: 'ITBIS', value: (s) => s.itbisAmount },
              { header: 'Total', value: (s) => s.total },
              { header: 'Metodo', value: (s) => METHOD_LABEL[s.paymentMethod] ?? s.paymentMethod },
              { header: 'Estado', value: (s) => STATUS_LABEL[s.paymentStatus] ?? s.paymentStatus },
              { header: 'Anulada', value: (s) => (s.cancelledAt ? 'Si' : 'No') },
            ]}
          />
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Ingresos" icono={<DollarSign className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.ingresos)} pie={`de ${kpis.ventas} ventas`} />
            <Kpi titulo="Ticket promedio" icono={<Hash className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.ticket)} pie="por venta" />
            <Kpi titulo="ITBIS recaudado" icono={<Receipt className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.itbis)} pie={`sobre ${formatCurrency(kpis.subtotal)} sin impuesto`} />
            <Kpi titulo="Artículos vendidos" icono={<Package className="h-4 w-4 text-muted-foreground" />}
                 valor={cantidad(kpis.articulos)} pie="unidades" />
            <Kpi titulo="Clientes registrados" icono={<Users2 className="h-4 w-4 text-muted-foreground" />}
                 valor={String(kpis.clientes)} pie={`${kpis.ventas - ventas.filter((s) => s.customerId).length} ventas de mostrador`} />
            <Kpi titulo="Descuentos" icono={<TicketPercent className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.descuentos)} pie="precio rebajado en caja" />
            <Kpi titulo="Anuladas" icono={<Ban className="h-4 w-4 text-muted-foreground" />}
                 valor={String(kpis.anuladas)} pie={formatCurrency(kpis.montoAnulado)} />
            <Kpi titulo="Sucursales con ventas" icono={<Store className="h-4 w-4 text-muted-foreground" />}
                 valor={String(porSucursal.length)} pie={selectedBranch === 'all' ? 'en el rango' : 'filtrada'} />
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Ventas por día</CardTitle>
              </CardHeader>
              <CardContent>
                {porDia.length > 0 ? (
                  <SalesChart data={porDia} />
                ) : (
                  <p className="pt-8 text-center text-sm text-muted-foreground">No hay ventas en este rango.</p>
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Ventas recientes</CardTitle>
              </CardHeader>
              <CardContent>
                {ventas.length > 0 ? (
                  <RecentSales sales={ventas.slice(0, 5)} />
                ) : (
                  <p className="pt-8 text-center text-sm text-muted-foreground">No hay ventas en este rango.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  <span>Por forma de cobro</span>
                </CardTitle>
                <CardDescription>
                  Crédito y financiamiento van por el total de la venta, no por lo abonado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabla
                  cabecera="Forma"
                  filas={porMetodo.map((f) => ({
                    clave: f.metodo,
                    etiqueta: METHOD_LABEL[f.metodo] ?? f.metodo,
                    ventas: f.ventas,
                    monto: f.monto,
                  }))}
                  pct={pct}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  <span>Por estado de la venta</span>
                </CardTitle>
                <CardDescription>Cuánto quedó cobrado y cuánto sigue pendiente de cobro.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabla
                  cabecera="Estado"
                  filas={porEstado.map((f) => ({
                    clave: f.estado,
                    etiqueta: STATUS_LABEL[f.estado] ?? f.estado,
                    ventas: f.ventas,
                    monto: f.monto,
                  }))}
                  pct={pct}
                />
              </CardContent>
            </Card>
          </div>

          {selectedBranch === 'all' && porSucursal.length > 1 && (
            <Card className="mt-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  <span>Por sucursal</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabla
                  cabecera="Sucursal"
                  filas={porSucursal.map((f) => ({
                    clave: f.sucursal,
                    etiqueta: f.sucursal,
                    ventas: f.ventas,
                    monto: f.monto,
                  }))}
                  pct={pct}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ titulo, icono, valor, pie }: { titulo: string; icono: React.ReactNode; valor: string; pie: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{titulo}</CardTitle>
        {icono}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{valor}</div>
        <p className="text-xs text-muted-foreground">{pie}</p>
      </CardContent>
    </Card>
  );
}

function Tabla({
  cabecera,
  filas,
  pct,
}: {
  cabecera: string;
  filas: { clave: string; etiqueta: string; ventas: number; monto: number }[];
  pct: (monto: number) => number;
}) {
  if (filas.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sin datos en este rango.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{cabecera}</TableHead>
          <TableHead className="text-right">Ventas</TableHead>
          <TableHead className="text-right">Monto</TableHead>
          <TableHead className="text-right">%</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((f) => (
          <TableRow key={f.clave}>
            <TableCell className="font-medium">{f.etiqueta}</TableCell>
            <TableCell className="text-right">{f.ventas}</TableCell>
            <TableCell className="text-right">{formatCurrency(f.monto)}</TableCell>
            <TableCell className="text-right">{pct(f.monto).toFixed(1)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
