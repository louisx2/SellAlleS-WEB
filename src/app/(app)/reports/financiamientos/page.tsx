'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, Store, Percent, TrendingUp, AlertTriangle, Wallet, CreditCard } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { cn, formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment } from '@/lib/supabase/mappers';
import type { CreditPayment, Sale } from '@/lib/types';

const round2 = (n: number) => Math.round(n * 100) / 100;

type DayBucket = { key: string; name: string; interes: number; mora: number };

// Reporte de la ganancia PROPIA del financiamiento: el interés que se cobra por
// financiar y la mora de las cuotas vencidas. El margen de la mercancía vendida
// no entra aquí — ese sale en /reports/ganancias.
export default function FinancingProfitReportPage() {
  // `sales` (estado del provider, identidad estable) dispara la recarga de
  // abonos; `financingSales` es la lista visible (propia + pool compartido).
  const { sales, financingSales } = useSales();
  const { profile } = useCompanyProfile();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [payments, setPayments] = React.useState<CreditPayment[]>([]);

  const range = React.useMemo(() => {
    if (!date?.from) return null;
    const from = new Date(date.from);
    from.setHours(0, 0, 0, 0);
    const to = date.to ? new Date(date.to) : new Date(date.from);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [date]);

  // Solo financiamientos con plan de interés: las ventas a crédito simple no
  // generan ganancia financiera y las anuladas no cuentan.
  const financings = React.useMemo(
    () => financingSales.filter((s) => !s.cancelledAt && s.paymentMethod === 'financing' && s.financingDetails),
    [financingSales]
  );

  const branchOptions = React.useMemo(
    () => Array.from(new Set(financings.map((s) => s.branchId).filter(Boolean))).sort(),
    [financings]
  );

  const visible = React.useMemo(
    () => (selectedBranch === 'all' ? financings : financings.filter((s) => s.branchId === selectedBranch)),
    [financings, selectedBranch]
  );

  // Interés pactado y qué proporción de cada cuota es interés. El plan de cuotas
  // cubre capital financiado + interés simple; el abono inicial no genera interés.
  const economicsOf = React.useCallback((sale: Sale) => {
    const fd = sale.financingDetails!;
    const interestAgreed = round2(fd.totalWithInterest - sale.total);
    const downPayment = fd.downPayment ?? 0;
    const principal = round2(sale.total - downPayment);
    const planTotal = round2(principal + interestAgreed);
    return {
      interestAgreed,
      downPayment,
      principal,
      planTotal,
      interestShare: planTotal > 0 ? interestAgreed / planTotal : 0,
    };
  }, []);

  // Abonos del rango. Se traen por fecha y se cruzan en el cliente contra los
  // financiamientos visibles: así el filtro de sucursal (y el de empresa) sale
  // de la misma lista que ya acota el provider.
  React.useEffect(() => {
    if (!range) { setPayments([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('credit_payments')
        .select('*, branches(name)')
        .gte('date', range.from.toISOString())
        .lte('date', range.to.toISOString())
        .order('date', { ascending: true });
      if (!cancelled) setPayments(data ? data.map(rowToCreditPayment) : []);
    })();
    return () => { cancelled = true; };
  }, [range, sales]);

  // --- Cartera: financiamientos originados en el rango ---
  const rows = React.useMemo(() => {
    return visible
      .filter((s) => !range || (new Date(s.createdAt) >= range.from && new Date(s.createdAt) <= range.to))
      .map((s) => {
        const e = economicsOf(s);
        const st = calculateFinancingStatus(s, profile.lateFeeRate);
        const inst = s.installments ?? [];
        // Cobrado del plan (capital + interés). Los financiamientos anteriores a
        // la tabla de cuotas no tienen filas: se cae a lo pagado menos el inicial.
        const planPaid = inst.length > 0
          ? round2(inst.reduce((a, i) => a + i.paidAmount, 0))
          : Math.max(round2(s.amountPaid - e.downPayment), 0);
        const interestCollected = round2(planPaid * e.interestShare);
        const lateFeeCollected = round2(inst.reduce((a, i) => a + i.lateFeePaid, 0));
        return {
          id: s.id,
          customer: s.customer?.name ?? 'Cliente',
          branch: s.branchId,
          date: new Date(s.createdAt),
          saleTotal: s.total,
          principal: e.principal,
          rate: s.financingDetails!.interestRate,
          installmentsCount: s.financingDetails!.installments,
          interestAgreed: e.interestAgreed,
          interestCollected,
          interestPending: Math.max(round2(e.interestAgreed - interestCollected), 0),
          lateFeeCollected,
          profit: round2(interestCollected + lateFeeCollected),
          pending: st.pendingBalance,
          overdue: st.isOverdue,
        };
      })
      .sort((a, b) => b.profit - a.profit);
  }, [visible, range, profile.lateFeeRate, economicsOf]);

  const totals = React.useMemo(() => ({
    count: rows.length,
    principal: round2(rows.reduce((a, r) => a + r.principal, 0)),
    interestAgreed: round2(rows.reduce((a, r) => a + r.interestAgreed, 0)),
    interestCollected: round2(rows.reduce((a, r) => a + r.interestCollected, 0)),
    interestPending: round2(rows.reduce((a, r) => a + r.interestPending, 0)),
    lateFeeCollected: round2(rows.reduce((a, r) => a + r.lateFeeCollected, 0)),
    profit: round2(rows.reduce((a, r) => a + r.profit, 0)),
    overdue: rows.filter((r) => r.overdue).length,
  }), [rows]);

  // --- Caja: ganancia efectivamente cobrada dentro del rango ---
  const period = React.useMemo(() => {
    const byId = new Map(visible.map((s) => [s.id, economicsOf(s)]));
    const daily = new Map<string, DayBucket>();
    let interes = 0;
    let mora = 0;
    let cobrado = 0;

    payments.forEach((p) => {
      if (!p.saleId) return;            // abono general a la deuda del cliente, no a un financiamiento
      const e = byId.get(p.saleId);
      if (!e) return;                   // venta a crédito simple, otra sucursal u otra empresa
      const fee = p.lateFeePaid;
      const int = round2((p.amount - fee) * e.interestShare);
      interes += int;
      mora += fee;
      cobrado += p.amount;

      const key = format(p.date, 'yyyy-MM-dd');
      const bucket = daily.get(key) ?? { key, name: format(p.date, 'dd MMM', { locale: es }), interes: 0, mora: 0 };
      bucket.interes = round2(bucket.interes + int);
      bucket.mora = round2(bucket.mora + fee);
      daily.set(key, bucket);
    });

    return {
      interes: round2(interes),
      mora: round2(mora),
      cobrado: round2(cobrado),
      total: round2(interes + mora),
      chart: Array.from(daily.values()).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }, [payments, visible, economicsOf]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader title="Ganancias de Financiamiento">
          <ExportButton
            filename="ganancias_financiamiento"
            rows={rows}
            columns={[
              { header: 'Cliente', value: (r) => r.customer },
              { header: 'Sucursal', value: (r) => r.branch },
              { header: 'Fecha', value: (r) => r.date.toLocaleDateString('es-DO') },
              { header: 'Total Venta (RD$)', value: (r) => r.saleTotal },
              { header: 'Capital Financiado (RD$)', value: (r) => r.principal },
              { header: 'Tasa (%)', value: (r) => r.rate },
              { header: 'Cuotas', value: (r) => r.installmentsCount },
              { header: 'Interes Pactado (RD$)', value: (r) => r.interestAgreed },
              { header: 'Interes Cobrado (RD$)', value: (r) => r.interestCollected },
              { header: 'Interes por Cobrar (RD$)', value: (r) => r.interestPending },
              { header: 'Mora Cobrada (RD$)', value: (r) => r.lateFeeCollected },
              { header: 'Ganancia Realizada (RD$)', value: (r) => r.profit },
              { header: 'Saldo Pendiente (RD$)', value: (r) => r.pending },
              { header: 'Estado', value: (r) => (r.overdue ? 'Atrasado' : 'Al dia') },
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

      {/* --- Ganancia cobrada en el rango (base caja: por fecha del abono) --- */}
      <div>
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
          Cobrado en el período
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-emerald-500/5 to-transparent">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ganancia de financiamiento</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-emerald-500">{formatCurrency(period.total)}</div>
              <p className="text-2xs text-muted-foreground mt-1">Interés + mora cobrados</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Interés cobrado</CardTitle>
              <Percent className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(period.interes)}</div>
              <p className="text-2xs text-muted-foreground mt-1">Parte de interés de cada cuota</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Mora cobrada</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(period.mora)}</div>
              <p className="text-2xs text-muted-foreground mt-1">Recargo por cuotas vencidas</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Abonos recibidos</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(period.cobrado)}</div>
              <p className="text-2xs text-muted-foreground mt-1">El resto es recuperación de capital</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* --- Gráfico de ganancia diaria --- */}
      <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Ganancia cobrada por día</CardTitle>
          <CardDescription className="text-2xs">Solo interés y mora; no incluye el capital recuperado.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            {period.chart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={period.chart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" fontSize={11} stroke="#888888" tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} stroke="#888888" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="interes" stackId="g" fill="#3b82f6" name="Interés" />
                  <Bar dataKey="mora" stackId="g" fill="#f97316" radius={[3, 3, 0, 0]} name="Mora" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No hay abonos de financiamiento en este rango.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Cartera originada en el rango (base devengado: por fecha de la venta) --- */}
      <div>
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
          Financiamientos otorgados en el período
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Capital financiado</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(totals.principal)}</div>
              <p className="text-2xs text-muted-foreground mt-1">{totals.count} financiamientos</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Interés pactado</CardTitle>
              <Percent className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(totals.interestAgreed)}</div>
              <p className="text-2xs text-muted-foreground mt-1">Ganancia esperada del plan</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Interés por cobrar</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(totals.interestPending)}</div>
              <p className="text-2xs text-muted-foreground mt-1">Aún dentro de las cuotas abiertas</p>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Atrasados</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{totals.overdue}</div>
              <p className="text-2xs text-muted-foreground mt-1">Mora cobrada {formatCurrency(totals.lateFeeCollected)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Detalle por financiamiento</CardTitle>
          <CardDescription className="text-2xs">
            Interés y mora acumulados a hoy de los financiamientos otorgados en el rango seleccionado.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-center">Plan</TableHead>
                  <TableHead className="text-right">Capital</TableHead>
                  <TableHead className="text-right">Interés pactado</TableHead>
                  <TableHead className="text-right">Interés cobrado</TableHead>
                  <TableHead className="text-right">Mora cobrada</TableHead>
                  <TableHead className="text-right">Ganancia</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/10">
                    <TableCell className="font-semibold">{r.customer}</TableCell>
                    <TableCell>{r.date.toLocaleDateString('es-DO')}</TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {r.installmentsCount} × {r.rate}%
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(r.principal)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(r.interestAgreed)}</TableCell>
                    <TableCell className="text-right text-blue-500">{formatCurrency(r.interestCollected)}</TableCell>
                    <TableCell className="text-right text-orange-500">{formatCurrency(r.lateFeeCollected)}</TableCell>
                    <TableCell className="text-right text-emerald-500 font-bold">{formatCurrency(r.profit)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.pending)}</TableCell>
                    <TableCell>
                      {r.overdue
                        ? <Badge variant="destructive">Atrasado</Badge>
                        : <Badge variant="outline">Al día</Badge>}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                      No se otorgaron financiamientos en el rango de fechas.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
