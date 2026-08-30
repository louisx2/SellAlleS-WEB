'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import {
  Calendar as CalendarIcon, Store, Wallet, Banknote, CreditCard, ArrowLeftRight,
  AlertTriangle, Coins, Users,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { useModules } from '@/context/modules-provider';
import { useSales } from '@/context/sales-provider';
import { supabase } from '@/lib/supabase/client';
import type { PaymentMethod } from '@/lib/types';

const round2 = (n: number) => Math.round(n * 100) / 100;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const METHOD_ICON = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowLeftRight,
} as const;

// De dónde vino el dinero. Es la pregunta que el reporte de ventas no contesta:
// una venta a crédito suma su total el día que se hace, y lo que el cliente
// paga después no aparece en ninguna parte.
type Origen = 'Abono inicial' | 'Financiamiento' | 'Crédito' | 'Abono general' | 'Préstamo';

const ORIGEN_ORDER: Origen[] = ['Financiamiento', 'Crédito', 'Abono inicial', 'Abono general', 'Préstamo'];

type Cobro = {
  id: string;
  date: Date;
  customer: string;
  origen: Origen;
  method: PaymentMethod;
  reference?: string;
  /** Lo que entró en caja. */
  amount: number;
  /** Parte del cobro que fue mora: ingreso del negocio, no baja la deuda. */
  lateFee: number;
  /** Lo que sí bajó la deuda. */
  principal: number;
  branch: string;
  user: string;
  notes?: string;
  voided: boolean;
  voidReason?: string;
};

export default function CobrosReportPage() {
  // `sales` solo se usa como disparador de recarga: cuando el provider
  // refresca tras un abono, este reporte se vuelve a traer.
  const { sales } = useSales();
  const { isModuleEnabled } = useModules();
  const hasPrestamos = isModuleEnabled('prestamos');

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [selectedMethod, setSelectedMethod] = React.useState('all');
  const [cobros, setCobros] = React.useState<Cobro[]>([]);
  const [loading, setLoading] = React.useState(true);

  const range = React.useMemo(() => {
    if (!date?.from) return null;
    const from = new Date(date.from);
    from.setHours(0, 0, 0, 0);
    const to = date.to ? new Date(date.to) : new Date(date.from);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [date]);

  React.useEffect(() => {
    if (!range) { setCobros([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      // RLS ya acota a la empresa y a las sucursales que el usuario ve (propias
      // más las de los pools de 'credito' y 'financiamiento').
      const creditQuery = supabase
        .from('credit_payments')
        .select('*, customers(name), branches(name), sales(payment_method, payment_status)')
        .gte('date', range.from.toISOString())
        .lte('date', range.to.toISOString())
        .order('date', { ascending: false });

      const loanQuery = hasPrestamos
        ? supabase
            .from('loan_payments')
            .select('*, customers(name), branches(name)')
            .gte('date', range.from.toISOString())
            .lte('date', range.to.toISOString())
            .order('date', { ascending: false })
        : Promise.resolve({ data: [] as any[] });

      const [credit, loan] = await Promise.all([creditQuery, loanQuery]);
      if (cancelled) return;

      const deCredito: Cobro[] = (credit.data ?? []).map((r: any) => {
        const lateFee = Number(r.late_fee_paid ?? 0);
        const amount = Number(r.amount);
        let origen: Origen;
        if (r.kind === 'down_payment') origen = 'Abono inicial';
        else if (r.kind === 'customer' || !r.sale_id) origen = 'Abono general';
        else if (r.sales?.payment_status === 'in_financing' || r.sales?.payment_method === 'financing') origen = 'Financiamiento';
        else origen = 'Crédito';

        return {
          id: r.id,
          date: new Date(r.date),
          customer: r.customers?.name ?? 'Cliente',
          origen,
          method: (r.method ?? 'cash') as PaymentMethod,
          reference: r.reference ?? undefined,
          amount,
          lateFee,
          principal: round2(amount - lateFee),
          branch: r.branches?.name ?? '—',
          user: r.user_name ?? '—',
          notes: r.notes ?? undefined,
          voided: !!r.voided_at,
          voidReason: r.void_reason ?? undefined,
        };
      });

      const dePrestamos: Cobro[] = (loan.data ?? []).map((r: any) => {
        const lateFee = Number(r.late_fee_paid ?? 0);
        const amount = Number(r.amount);
        return {
          id: r.id,
          date: new Date(r.date),
          customer: r.customers?.name ?? 'Cliente',
          origen: 'Préstamo' as const,
          method: (r.method ?? 'cash') as PaymentMethod,
          reference: r.reference ?? undefined,
          amount,
          lateFee,
          principal: round2(amount - lateFee),
          branch: r.branches?.name ?? '—',
          user: r.user_name ?? '—',
          notes: r.notes ?? undefined,
          voided: false,
          voidReason: undefined,
        };
      });

      setCobros([...deCredito, ...dePrestamos].sort((a, b) => b.date.getTime() - a.date.getTime()));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [range, sales, hasPrestamos]);

  const branchOptions = React.useMemo(
    () => Array.from(new Set(cobros.map((c) => c.branch).filter((b) => b && b !== '—'))).sort(),
    [cobros]
  );

  const visibles = React.useMemo(
    () => cobros.filter((c) =>
      (selectedBranch === 'all' || c.branch === selectedBranch) &&
      (selectedMethod === 'all' || c.method === selectedMethod)
    ),
    [cobros, selectedBranch, selectedMethod]
  );

  // Un abono anulado nunca fue dinero: se muestra en el detalle para dejar
  // rastro, pero no suma en ningún total.
  const validos = React.useMemo(() => visibles.filter((c) => !c.voided), [visibles]);

  const totals = React.useMemo(() => ({
    amount: round2(validos.reduce((a, c) => a + c.amount, 0)),
    principal: round2(validos.reduce((a, c) => a + c.principal, 0)),
    lateFee: round2(validos.reduce((a, c) => a + c.lateFee, 0)),
    count: validos.length,
    voided: visibles.filter((c) => c.voided).length,
  }), [validos, visibles]);

  const porMetodo = React.useMemo(() => {
    const base: Record<PaymentMethod, number> = { cash: 0, card: 0, transfer: 0 };
    validos.forEach((c) => { base[c.method] = round2(base[c.method] + c.amount); });
    return base;
  }, [validos]);

  const porOrigen = React.useMemo(() => {
    const map = new Map<Origen, { origen: Origen; amount: number; principal: number; lateFee: number; count: number }>();
    validos.forEach((c) => {
      const row = map.get(c.origen) ?? { origen: c.origen, amount: 0, principal: 0, lateFee: 0, count: 0 };
      row.amount = round2(row.amount + c.amount);
      row.principal = round2(row.principal + c.principal);
      row.lateFee = round2(row.lateFee + c.lateFee);
      row.count += 1;
      map.set(c.origen, row);
    });
    return ORIGEN_ORDER.map((o) => map.get(o)).filter(Boolean) as {
      origen: Origen; amount: number; principal: number; lateFee: number; count: number;
    }[];
  }, [validos]);

  const porCobrador = React.useMemo(() => {
    const map = new Map<string, { user: string; amount: number; count: number }>();
    validos.forEach((c) => {
      const row = map.get(c.user) ?? { user: c.user, amount: 0, count: 0 };
      row.amount = round2(row.amount + c.amount);
      row.count += 1;
      map.set(c.user, row);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [validos]);

  const chart = React.useMemo(() => {
    const map = new Map<string, { key: string; name: string; Efectivo: number; Tarjeta: number; Transferencia: number }>();
    validos.forEach((c) => {
      const key = format(c.date, 'yyyy-MM-dd');
      const bucket = map.get(key) ?? {
        key, name: format(c.date, 'dd MMM', { locale: es }),
        Efectivo: 0, Tarjeta: 0, Transferencia: 0,
      };
      const label = METHOD_LABEL[c.method];
      if (label === 'Efectivo') bucket.Efectivo = round2(bucket.Efectivo + c.amount);
      if (label === 'Tarjeta') bucket.Tarjeta = round2(bucket.Tarjeta + c.amount);
      if (label === 'Transferencia') bucket.Transferencia = round2(bucket.Transferencia + c.amount);
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [validos]);

  const pct = (n: number) => (totals.amount > 0 ? Math.round((n / totals.amount) * 100) : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <PageHeader title="Cobros Recibidos">
          <ExportButton
            filename="cobros_recibidos"
            rows={visibles}
            columns={[
              { header: 'Fecha', value: (c) => c.date.toLocaleString('es-DO') },
              { header: 'Cliente', value: (c) => c.customer },
              { header: 'Origen', value: (c) => c.origen },
              { header: 'Metodo', value: (c) => METHOD_LABEL[c.method] },
              { header: 'Referencia', value: (c) => c.reference ?? '' },
              { header: 'Monto (RD$)', value: (c) => c.amount },
              { header: 'Capital (RD$)', value: (c) => c.principal },
              { header: 'Mora (RD$)', value: (c) => c.lateFee },
              { header: 'Sucursal', value: (c) => c.branch },
              { header: 'Cobrador', value: (c) => c.user },
              { header: 'Estado', value: (c) => (c.voided ? 'ANULADO' : 'Valido') },
              { header: 'Motivo de anulacion', value: (c) => c.voidReason ?? '' },
            ]}
          />
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3">
          {branchOptions.length > 1 && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-[180px] bg-card border-muted-foreground/20">
                <Store className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branchOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={selectedMethod} onValueChange={setSelectedMethod}>
            <SelectTrigger className="w-[170px] bg-card border-muted-foreground/20">
              <Wallet className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Método" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los métodos</SelectItem>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="card">Tarjeta</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-[260px] justify-start text-left font-normal bg-card border-muted-foreground/20',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'dd LLL y', { locale: es })} - {format(date.to, 'dd LLL y', { locale: es })}
                    </>
                  ) : (
                    format(date.from, 'dd LLL y', { locale: es })
                  )
                ) : (
                  <span>Seleccionar Rango</span>
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
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <p className="text-sm text-muted-foreground -mt-2">
        Dinero que entró por cobros de ventas a crédito y financiadas
        {hasPrestamos && <> y de préstamos</>}. El reporte de ventas cuenta la venta completa el día
        que se hace; este cuenta lo que el cliente pagó, el día que lo pagó.
      </p>

      {/* --- Totales del período --- */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-emerald-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total cobrado</CardTitle>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totals.amount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.count} cobros
              {totals.voided > 0 && <> · {totals.voided} anulado{totals.voided > 1 ? 's' : ''} (no suman)</>}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Abonado a la deuda</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.principal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Capital: es lo que bajó el balance</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mora cobrada</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totals.lateFee)}</div>
            <p className="text-xs text-muted-foreground mt-1">Ingreso del negocio, no baja deuda</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cobro promedio</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totals.count > 0 ? round2(totals.amount / totals.count) : 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {porCobrador.length} cobrador{porCobrador.length === 1 ? '' : 'es'} en el período
            </p>
          </CardContent>
        </Card>
      </div>

      {/* --- La pregunta del cliente: cuánto entró por cada vía --- */}
      <div className="grid gap-4 sm:grid-cols-3">
        {(['cash', 'card', 'transfer'] as PaymentMethod[]).map((m) => {
          const Icon = METHOD_ICON[m];
          return (
            <Card key={m} className="bg-card/40 backdrop-blur-sm border-muted/50">
              <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {METHOD_LABEL[m]}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">{formatCurrency(porMetodo[m])}</div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct(porMetodo[m])}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{pct(porMetodo[m])}% de lo cobrado</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Cobros por día</CardTitle>
            <CardDescription className="text-xs">Desglosado por forma de pago</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              {chart.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" fontSize={11} stroke="#888888" tickLine={false} axisLine={false} />
                    <YAxis fontSize={11} stroke="#888888" tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Legend />
                    <Bar dataKey="Efectivo" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Tarjeta" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Transferencia" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No hubo cobros en este período.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">De dónde vino el dinero</CardTitle>
            <CardDescription className="text-xs">Financiamiento, crédito, inicial o préstamo</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origen</TableHead>
                    <TableHead className="text-right">Cobros</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Mora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porOrigen.length > 0 ? porOrigen.map((r) => (
                    <TableRow key={r.origen}>
                      <TableCell className="font-medium">{r.origen}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(r.amount)}</TableCell>
                      <TableCell className="text-right">{r.lateFee > 0 ? formatCurrency(r.lateFee) : '—'}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={4} className="h-20 text-center">Sin cobros.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {porCobrador.length > 1 && (
        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Quién cobró</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Cobros</TableHead>
                    <TableHead className="text-right">Total cobrado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porCobrador.map((r) => (
                    <TableRow key={r.user}>
                      <TableCell className="font-medium">{r.user}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detalle de cobros</CardTitle>
          <CardDescription>
            Cada abono recibido en el período, con su referencia para conciliar contra el banco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Capital</TableHead>
                  <TableHead className="text-right">Mora</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Cobró</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center">Cargando cobros…</TableCell></TableRow>
                ) : visibles.length > 0 ? visibles.map((c) => (
                  <TableRow key={c.id} className={c.voided ? 'opacity-60' : undefined}>
                    <TableCell className="whitespace-nowrap">{c.date.toLocaleString('es-DO')}</TableCell>
                    <TableCell className="font-medium">{c.customer}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.origen}</Badge>
                      {c.voided && (
                        <Badge variant="destructive" className="ml-2" title={c.voidReason}>Anulado</Badge>
                      )}
                    </TableCell>
                    <TableCell>{METHOD_LABEL[c.method]}</TableCell>
                    <TableCell className="max-w-48 truncate" title={c.reference}>{c.reference ?? '—'}</TableCell>
                    <TableCell className={cn('text-right font-semibold', c.voided && 'line-through')}>
                      {formatCurrency(c.amount)}
                    </TableCell>
                    <TableCell className={cn('text-right', c.voided && 'line-through')}>
                      {formatCurrency(c.principal)}
                    </TableCell>
                    <TableCell className={cn('text-right', c.voided && 'line-through')}>
                      {c.lateFee > 0 ? formatCurrency(c.lateFee) : '—'}
                    </TableCell>
                    <TableCell>{c.branch}</TableCell>
                    <TableCell>{c.user}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center">No hubo cobros en este período.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
