'use client';

import * as React from 'react';
import { format, startOfMonth, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import {
  Calendar as CalendarIcon, Loader2, Wallet, Banknote, CreditCard as CardIcon,
  ArrowLeftRight, AlertTriangle, CheckCircle2, Users2, HandCoins,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToSale } from '@/lib/supabase/mappers';
import { fetchAllRows, fetchAllByIds } from '@/lib/supabase/paginate';
import type { PaymentMethod, Sale } from '@/lib/types';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const SALE_SELECT = '*, customers(*), branches(name), financing_installments(*)';

const round2 = (n: number) => Math.round(n * 100) / 100;

// Lo que realmente se debe por una venta a crédito: el financiamiento cobra
// interés, así que su deuda es el total del plan, no el total de la mercancía.
const deudaDe = (s: Sale) =>
  s.financingDetails ? Number(s.financingDetails.totalWithInterest) : s.total;

// El plan de cuotas es lo que distingue un financiamiento. El método de pago no
// sirve para clasificar: una venta en efectivo pagada de menos queda a crédito
// igual (cart-provider.tsx), con payment_method 'cash'.
const esFinanciada = (s: Sale) => !!s.financingDetails || s.paymentStatus === 'in_financing';

const tipoDe = (s: Sale) => (esFinanciada(s) ? 'Financiamiento' : 'Crédito');

/** Abono tal como sale de credit_payments, sin pasar por el mapper (necesitamos el uuid de sucursal). */
type Abono = {
  id: string;
  date: Date;
  saleId: string | null;
  customerId: string;
  branchId: string | null;
  branchName: string;
  amount: number;
  lateFeePaid: number;
  /** Parte del abono que bajó la deuda (el resto fue mora). */
  capital: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  userName?: string;
};

const rowToAbono = (r: any): Abono => ({
  id: r.id,
  date: new Date(r.date),
  saleId: r.sale_id ?? null,
  customerId: r.customer_id ?? '',
  branchId: r.branch_id ?? null,
  branchName: r.branches?.name ?? '',
  amount: Number(r.amount ?? 0),
  lateFeePaid: Number(r.late_fee_paid ?? 0),
  capital: round2(Number(r.amount ?? 0) - Number(r.late_fee_paid ?? 0)),
  method: (r.method ?? 'cash') as PaymentMethod,
  reference: r.reference ?? undefined,
  notes: r.notes ?? undefined,
  userName: r.user_name ?? undefined,
});

/** Fila del detalle de cobros. */
type Cobro = Abono & {
  customerName: string;
  concepto: string;
  /** Saldo de la venta después de este abono; null en abonos generales (no van ligados a una venta). */
  saldoDespues: number | null;
  /** Este abono fue el que dejó la venta saldada. */
  liquido: boolean;
};

/** Deuda que quedó en cero dentro del rango. */
type Liquidada = {
  saleId: string;
  customerName: string;
  tipo: string;
  branchName: string;
  saleDate: Date;
  settledDate: Date;
  deuda: number;
  /** Suma de los abonos registrados contra esta venta, sin la mora. */
  abonado: number;
  mora: number;
  dias: number;
  /**
   * La fecha sale del abono que efectivamente dejó la venta en cero. Cuando la
   * deuda se cerró con abonos generales —que `register_customer_payment`
   * reparte entre las ventas abiertas sin dejar rastro de cuál cubrió cuál— la
   * fecha es la del último abono general posterior a la venta: es una
   * estimación, y se marca como tal para no darla por exacta.
   */
  exacta: boolean;
};

export default function CobrosCreditoReportPage() {
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const esAdmin = appUser?.role === 'admin';

  // Este reporte se usa sobre todo para cuadrar el día, así que arranca en hoy.
  const [date, setDate] = React.useState<DateRange | undefined>({ from: new Date(), to: new Date() });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [cobros, setCobros] = React.useState<Cobro[]>([]);
  const [liquidadas, setLiquidadas] = React.useState<Liquidada[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!esAdmin && appUser?.activeBranchId) setSelectedBranch(appUser.activeBranchId);
  }, [esAdmin, appUser?.activeBranchId]);

  const desdeIso = React.useMemo(() => {
    if (!date?.from) return null;
    const d = new Date(date.from);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [date?.from]);

  const hastaIso = React.useMemo(() => {
    const base = date?.to ?? date?.from;
    if (!base) return null;
    const d = new Date(base);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [date?.to, date?.from]);

  React.useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      if (!desdeIso || !hastaIso) {
        // Al borrar el rango no hay nada que pedir: se limpia en vez de dejar
        // el spinner girando sobre los datos del rango anterior.
        setCobros([]); setLiquidadas([]); setError(false); setLoading(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {

        // 1. Abonos del rango (lo que entró por caja en concepto de crédito).
        const pagosRango = await fetchAllRows((desde, hasta) => {
          let q = supabase
            .from('credit_payments')
            .select('*, branches(name)')
            .gte('date', desdeIso)
            .lte('date', hastaIso)
            .order('date', { ascending: false })
            .order('id', { ascending: false })
            .range(desde, hasta);
          if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
          return q;
        });
        if (cancelado) return;

        const abonosRango = pagosRango.map(rowToAbono);
        const customerIds = Array.from(new Set(abonosRango.map((a) => a.customerId).filter(Boolean)));
        if (customerIds.length === 0) {
          // Sin clientes que resolver no hay saldos ni liquidaciones que
          // reconstruir, pero el dinero entró: el detalle se muestra igual.
          setCobros(abonosRango.map((a) => ({
            ...a,
            customerName: 'Cliente',
            concepto: a.saleId ? 'Venta a crédito' : 'Abono general a deuda',
            saldoDespues: null,
            liquido: false,
          })));
          setLiquidadas([]);
          setLoading(false);
          return;
        }

        // 2. Historial completo de esos clientes: hace falta para reconstruir el
        //    saldo que quedó después de cada abono y para saber cuál cerró la deuda.
        //    Sin filtro de sucursal a propósito: la deuda es del cliente, se cobre donde se cobre.
        const saleIdsRango = Array.from(
          new Set(abonosRango.map((a) => a.saleId).filter(Boolean) as string[])
        );

        const [pagosCliente, ventasAbiertas, ventasAbonadas, clientesRows] = await Promise.all([
          fetchAllByIds(customerIds, (lote, desde, hasta) =>
            supabase
              .from('credit_payments')
              .select('*, branches(name)')
              .in('customer_id', lote)
              .order('date', { ascending: true })
              .order('id', { ascending: true })
              .range(desde, hasta)),
          // Ventas del cliente que son o fueron una deuda: las que siguen
          // abiertas (incluidas las de contado que se pagaron de menos) y las
          // que nacieron a crédito o financiadas, ya saldadas o no.
          fetchAllByIds(customerIds, (lote, desde, hasta) =>
            supabase
              .from('sales')
              .select(SALE_SELECT)
              .in('customer_id', lote)
              .or('payment_status.in.(credit,in_financing),payment_method.in.(credit,financing)')
              .order('id', { ascending: true })
              .range(desde, hasta)),
          // Y las que ya se saldaron: se las reconoce por haber recibido un
          // abono en el rango, porque al quedar en 'paid' no se distinguen de
          // una venta de contado.
          fetchAllByIds(saleIdsRango, (lote, desde, hasta) =>
            supabase
              .from('sales')
              .select(SALE_SELECT)
              .in('id', lote)
              .order('id', { ascending: true })
              .range(desde, hasta)),
          fetchAllByIds(customerIds, (lote, desde, hasta) =>
            supabase.from('customers').select('id, name').in('id', lote)
              .order('id', { ascending: true })
              .range(desde, hasta)),
        ]);
        if (cancelado) return;

        const historial = pagosCliente.map(rowToAbono);
        // Las dos consultas se solapan en las ventas abiertas que recibieron un
        // abono del rango; se deduplica por id.
        const ventas = Array.from(
          new Map(
            [...ventasAbiertas, ...ventasAbonadas].map(rowToSale).map((v) => [v.id, v])
          ).values()
        ).filter((s) => !s.cancelledAt);
        const nombre = new Map<string, string>(clientesRows.map((c: any) => [c.id, c.name]));

        // Abonos agrupados por venta, en orden cronológico.
        const porVenta = new Map<string, Abono[]>();
        for (const a of historial) {
          if (!a.saleId) continue;
          const lista = porVenta.get(a.saleId) ?? [];
          lista.push(a);
          porVenta.set(a.saleId, lista);
        }
        // Abonos generales (no ligados a una venta): el RPC los reparte entre las
        // deudas abiertas del cliente, así que sirven para fechar liquidaciones.
        const generalesPorCliente = new Map<string, Abono[]>();
        for (const a of historial) {
          if (a.saleId) continue;
          const lista = generalesPorCliente.get(a.customerId) ?? [];
          lista.push(a);
          generalesPorCliente.set(a.customerId, lista);
        }

        // El saldo corrido de una venta solo se puede reconstruir si se conoce con
        // qué saldo abrió. El financiamiento guarda su inicial y los abonos
        // generales no lo tocan (register_customer_payment solo reparte entre
        // ventas con payment_status = 'credit'), así que siempre es reconstruible.
        // Una venta a crédito simple hay que despejarla de amount_paid, y ese
        // despeje absorbe lo que hayan aportado los abonos generales del cliente:
        // si los hay, no se puede afirmar ni el saldo ni cuál abono la cerró.
        const reconstruible = (venta: Sale) =>
          esFinanciada(venta) ||
          (generalesPorCliente.get(venta.customerId ?? '') ?? [])
            .every((p) => p.date < venta.createdAt);

        const saldoDespues = new Map<string, number>();
        const liquidoPor = new Map<string, string>(); // saleId -> id del abono que la cerró

        for (const venta of ventas) {
          if (!reconstruible(venta)) continue;
          const lista = porVenta.get(venta.id) ?? [];
          const capitalTotal = round2(lista.reduce((a, p) => a + p.capital, 0));
          const inicial = venta.financingDetails?.downPayment != null
            ? Number(venta.financingDetails.downPayment)
            : Math.max(round2(venta.amountPaid - capitalTotal), 0);
          const deuda = deudaDe(venta);
          let acumulado = inicial;
          for (const p of lista) {
            acumulado = round2(acumulado + p.capital);
            const restante = Math.max(round2(deuda - acumulado), 0);
            saldoDespues.set(p.id, restante);
            if (restante <= 0.01 && !liquidoPor.has(venta.id)) liquidoPor.set(venta.id, p.id);
          }
        }

        // 3. Detalle de cobros del rango.
        const ventaPorId = new Map<string, Sale>(ventas.map((v) => [v.id, v]));
        const detalle: Cobro[] = abonosRango.map((a) => {
          const venta = a.saleId ? ventaPorId.get(a.saleId) : undefined;
          return {
            ...a,
            customerName: nombre.get(a.customerId) ?? 'Cliente',
            concepto: a.saleId
              ? (venta ? tipoDe(venta) : 'Venta no disponible')
              : 'Abono general a deuda',
            saldoDespues: a.saleId ? saldoDespues.get(a.id) ?? null : null,
            liquido: !!(venta && liquidoPor.get(venta.id) === a.id),
          };
        });

        // 4. Deudas que quedaron saldadas dentro del rango. La fecha de liquidación
        //    es la del último abono que recibió esa venta; si nunca tuvo abonos
        //    propios (se pagó con abonos generales) se usa el último abono general
        //    del cliente posterior a la venta, que es el que la cerró en el reparto.
        const desde = new Date(desdeIso);
        const hasta = new Date(hastaIso);
        const cerradas: Liquidada[] = [];

        for (const venta of ventas) {
          if (venta.paymentStatus !== 'paid') continue;
          // Una venta de contado nunca fue una deuda: solo cuentan las que
          // nacieron a crédito o que recibieron abonos.
          const nacioDeuda = venta.paymentMethod === 'credit' || venta.paymentMethod === 'financing';
          if (!nacioDeuda && (porVenta.get(venta.id) ?? []).length === 0) continue;

          const propios = porVenta.get(venta.id) ?? [];
          const ultimoPropio = propios.length > 0 ? propios[propios.length - 1] : undefined;

          // Abono al que se le atribuye el cierre: de él salen la fecha y la
          // sucursal con las que esta deuda entra al reporte.
          let cierre: Abono | undefined;
          let exacta = false;
          if (reconstruible(venta)) {
            // Se sabe cuál abono la dejó en cero.
            const cerroId = liquidoPor.get(venta.id);
            const cerro = cerroId ? propios.find((p) => p.id === cerroId) : undefined;
            cierre = cerro ?? ultimoPropio;
            exacta = !!cerro;
          } else {
            // Crédito simple de un cliente que además abonó a deuda general.
            // Si los abonos propios ya cubren la deuda entera, la cerró uno de
            // ellos y se sabe cuál sin conocer el inicial: el primero cuyo
            // acumulado alcanza el total.
            const deuda = deudaDe(venta);
            let acumulado = 0;
            const propioQueCubre = propios.find((p) => {
              acumulado = round2(acumulado + p.capital);
              return acumulado >= deuda - 0.01;
            });
            if (propioQueCubre) {
              cierre = propioQueCubre;
              exacta = true;
            } else {
              // La terminaron de pagar abonos generales: se le atribuye al
              // primero que, sumando desde el último abono propio, alcanza para
              // cubrir lo que faltaba. Sigue siendo una estimación, pero acotada:
              // no se la lleva un abono muy posterior que ya no tenía que ver.
              let falta = round2(deuda - acumulado);
              cierre = (generalesPorCliente.get(venta.customerId ?? '') ?? [])
                .filter((p) => p.date >= (ultimoPropio?.date ?? venta.createdAt))
                .find((p) => {
                  falta = round2(falta - p.capital);
                  return falta <= 0.01;
                }) ?? ultimoPropio;
            }
          }
          // Sin un solo abono registrado no hubo cobro que reportar (venta saldada
          // en el acto o migrada): queda fuera para no inventar una fecha.
          const settled = cierre?.date;
          if (!settled || settled < desde || settled > hasta) continue;
          // Se filtra por la sucursal donde entró el dinero, igual que los
          // cobros, para que los dos bloques del reporte hablen de lo mismo.
          if (selectedBranch !== 'all' && cierre?.branchId !== selectedBranch) continue;

          // Solo los abonos ligados a esta venta, y sin la mora, que va en su
          // propia columna: lo que entró por abonos generales no es atribuible a
          // una venta concreta y repartirlo aquí sería inventar el desglose.
          const abonado = round2(propios.reduce((a, p) => a + p.capital, 0));
          const mora = round2(propios.reduce((a, p) => a + p.lateFeePaid, 0));
          cerradas.push({
            saleId: venta.id,
            customerName: venta.customer?.name ?? nombre.get(venta.customerId ?? '') ?? 'Cliente',
            tipo: tipoDe(venta),
            // La del abono que la cerró, que es por la que se filtra.
            branchName: cierre?.branchName || venta.branchId,
            saleDate: venta.createdAt,
            settledDate: settled,
            deuda: deudaDe(venta),
            abonado,
            mora,
            exacta,
            dias: Math.max(
              Math.round((settled.getTime() - venta.createdAt.getTime()) / 86_400_000),
              0
            ),
          });
        }
        cerradas.sort((a, b) => b.settledDate.getTime() - a.settledDate.getTime());

        setCobros(detalle);
        setLiquidadas(cerradas);
      } catch {
        // Una consulta a medias daría totales que parecen completos: se descarta
        // todo y se avisa, que no es lo mismo que no haber cobrado nada.
        if (!cancelado) { setCobros([]); setLiquidadas([]); setError(true); }
      }
      if (!cancelado) setLoading(false);
    };
    cargar();
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, selectedBranch]);

  const kpis = React.useMemo(() => {
    const porMetodo: Record<PaymentMethod, number> = { cash: 0, card: 0, transfer: 0 };
    let total = 0, capital = 0, mora = 0;
    const clientes = new Set<string>();
    for (const c of cobros) {
      total += c.amount;
      capital += c.capital;
      mora += c.lateFeePaid;
      porMetodo[c.method] = round2((porMetodo[c.method] ?? 0) + c.amount);
      if (c.customerId) clientes.add(c.customerId);
    }
    return {
      total: round2(total),
      capital: round2(capital),
      mora: round2(mora),
      porMetodo,
      clientes: clientes.size,
      cobros: cobros.length,
      cerradas: liquidadas.length,
      montoCerrado: round2(liquidadas.reduce((a, l) => a + l.deuda, 0)),
    };
  }, [cobros, liquidadas]);

  const presets: { label: string; range: DateRange }[] = [
    { label: 'Hoy', range: { from: new Date(), to: new Date() } },
    { label: '7 días', range: { from: subDays(new Date(), 6), to: new Date() } },
    { label: '30 días', range: { from: subDays(new Date(), 29), to: new Date() } },
    { label: 'Este mes', range: { from: startOfMonth(new Date()), to: new Date() } },
  ];

  return (
    <div>
      <PageHeader title="Cobros de Crédito">
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
              <div className="flex flex-wrap gap-1 border-b p-2">
                {presets.map((p) => (
                  <Button key={p.label} variant="ghost" size="sm" onClick={() => setDate(p.range)}>
                    {p.label}
                  </Button>
                ))}
              </div>
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
            filename="cobros_credito"
            rows={cobros}
            columns={[
              { header: 'Fecha', value: (c) => c.date.toLocaleString('es-DO') },
              { header: 'Cliente', value: (c) => c.customerName },
              { header: 'Concepto', value: (c) => c.concepto },
              { header: 'Monto', value: (c) => c.amount },
              { header: 'Aplicado a la deuda', value: (c) => c.capital },
              { header: 'Mora', value: (c) => c.lateFeePaid },
              { header: 'Metodo', value: (c) => METHOD_LABEL[c.method] ?? c.method },
              { header: 'Referencia', value: (c) => c.reference ?? '' },
              { header: 'Saldo despues', value: (c) => (c.saldoDespues != null ? c.saldoDespues : '') },
              { header: 'Liquido la deuda', value: (c) => (c.liquido ? 'Si' : 'No') },
              { header: 'Sucursal', value: (c) => c.branchName },
              { header: 'Usuario', value: (c) => c.userName ?? '' },
              { header: 'Notas', value: (c) => c.notes ?? '' },
            ]}
          />
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No se pudieron cargar los cobros de este rango. Vuelve a intentarlo:
            los totales en cero serían engañosos.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi titulo="Total cobrado" icono={<Wallet className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.total)} pie={`${kpis.cobros} abonos de ${kpis.clientes} clientes`} />
            <Kpi titulo="Aplicado a la deuda" icono={<HandCoins className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.capital)} pie="bajó el balance del cliente" />
            <Kpi titulo="Mora cobrada" icono={<AlertTriangle className="h-4 w-4 text-orange-500" />}
                 valor={formatCurrency(kpis.mora)} pie="recargo por cuotas vencidas" />
            <Kpi titulo="Deudas finalizadas" icono={<CheckCircle2 className="h-4 w-4 text-green-600" />}
                 valor={String(kpis.cerradas)} pie={`${formatCurrency(kpis.montoCerrado)} saldados`} />
            <Kpi titulo="Efectivo" icono={<Banknote className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.porMetodo.cash)} pie="entró en caja" />
            <Kpi titulo="Tarjeta" icono={<CardIcon className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.porMetodo.card)} pie="cobrado con tarjeta" />
            <Kpi titulo="Transferencia" icono={<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />}
                 valor={formatCurrency(kpis.porMetodo.transfer)} pie="cobrado por transferencia" />
            <Kpi titulo="Clientes que abonaron" icono={<Users2 className="h-4 w-4 text-muted-foreground" />}
                 valor={String(kpis.clientes)} pie="en el rango" />
          </div>

          <Card className="mt-8">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle>Deudas finalizadas en el período</CardTitle>
                <CardDescription>
                  Ventas a crédito y financiamientos que quedaron en cero con un abono de este rango.
                  En las marcadas como estimadas no se puede saber cuál abono las cerró, porque el
                  cliente también abonó a deuda general y la base no liga esos abonos a una venta.
                </CardDescription>
              </div>
              <ExportButton
                filename="deudas_finalizadas"
                rows={liquidadas}
                columns={[
                  { header: 'Cliente', value: (l) => l.customerName },
                  { header: 'Tipo', value: (l) => l.tipo },
                  { header: 'Fecha de la venta', value: (l) => l.saleDate.toLocaleDateString('es-DO') },
                  { header: 'Saldada el', value: (l) => l.settledDate.toLocaleString('es-DO') },
                  { header: 'Fecha exacta', value: (l) => (l.exacta ? 'Si' : 'Estimada') },
                  { header: 'Dias', value: (l) => l.dias },
                  { header: 'Deuda total', value: (l) => l.deuda },
                  { header: 'Abonos a esta venta (sin mora)', value: (l) => l.abonado },
                  { header: 'Mora pagada', value: (l) => l.mora },
                  { header: 'Sucursal', value: (l) => l.branchName },
                ]}
              />
            </CardHeader>
            <CardContent>
              {liquidadas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Ninguna deuda quedó saldada en este rango.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Venta</TableHead>
                        <TableHead>Saldada el</TableHead>
                        <TableHead className="text-right">Tardó</TableHead>
                        <TableHead className="text-right">Deuda total</TableHead>
                        <TableHead className="text-right">Abonos a esta venta</TableHead>
                        <TableHead className="text-right">Mora</TableHead>
                        <TableHead>Sucursal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {liquidadas.map((l) => (
                        <TableRow key={l.saleId}>
                          <TableCell className="font-medium">{l.customerName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{l.tipo}</Badge>
                          </TableCell>
                          <TableCell>{l.saleDate.toLocaleDateString('es-DO')}</TableCell>
                          <TableCell>
                            {l.settledDate.toLocaleString('es-DO')}
                            {!l.exacta && (
                              <span
                                className="block text-xs text-muted-foreground"
                                title="No se pudo determinar con certeza cuál abono la cerró; es la fecha del último que pudo aplicarle algo."
                              >
                                fecha estimada
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{l.dias} d</TableCell>
                          <TableCell className="text-right">{formatCurrency(l.deuda)}</TableCell>
                          <TableCell className="text-right text-green-600">
                            {l.abonado > 0 ? formatCurrency(l.abonado) : (
                              <span className="text-muted-foreground" title="Se cobró con abonos generales al cliente.">
                                abono general
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-orange-500">{formatCurrency(l.mora)}</TableCell>
                          <TableCell>{l.branchName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Detalle de cobros</CardTitle>
              <CardDescription>
                Cada abono recibido en el rango. El saldo es el de la venta abonada; los abonos
                generales bajan la deuda del cliente y se reparten entre sus ventas abiertas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cobros.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No se recibió ningún abono de crédito en este rango.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Concepto</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">A la deuda</TableHead>
                        <TableHead className="text-right">Mora</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead className="text-right">Saldo después</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Usuario</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cobros.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="whitespace-nowrap">{c.date.toLocaleString('es-DO')}</TableCell>
                          <TableCell className="font-medium">{c.customerName}</TableCell>
                          <TableCell>
                            <span className="flex flex-wrap items-center gap-1">
                              {c.concepto}
                              {c.liquido && <Badge className="bg-green-600">Saldó la deuda</Badge>}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(c.amount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.capital)}</TableCell>
                          <TableCell className="text-right text-orange-500">
                            {c.lateFeePaid > 0 ? formatCurrency(c.lateFeePaid) : '—'}
                          </TableCell>
                          <TableCell>
                            {METHOD_LABEL[c.method] ?? c.method}
                            {c.reference && (
                              <span className="block text-xs text-muted-foreground">{c.reference}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.saldoDespues != null ? (
                              <span className={c.saldoDespues <= 0.01 ? 'text-green-600 font-semibold' : undefined}>
                                {formatCurrency(c.saldoDespues)}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>{c.branchName}</TableCell>
                          <TableCell>{c.userName ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
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
