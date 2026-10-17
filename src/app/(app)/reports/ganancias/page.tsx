'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, DollarSign, TrendingUp, ArrowDownRight, ArrowUpRight, Percent, Store, FileText, FileWarning } from 'lucide-react';
import { cn, ITBIS_RATE } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { formatQty } from '@/lib/units';
import type { CartItem, Sale } from '@/lib/types';
import { isUncostedQuick, lineBase, quickUnitPrice, topProductKey } from '@/lib/quick-sales';
import { useSales } from '@/context/sales-provider';
import { useExpenses } from '@/context/expense-provider';
import { useProducts } from '@/context/product-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { ExportButton } from '@/components/reports/export-button';
import { supabase } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import {
  ABONO_COBRADO_SELECT, rowToAbonoCobrado, realizaciones, fraccionCobrada, type AbonoCobrado,
} from '@/lib/ganancia-realizada';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function GananciasReportPage() {
  const { sales: allSalesRaw } = useSales();
  // Las ventas anuladas no cuentan como ingreso ni como costo.
  const allSales = React.useMemo(() => allSalesRaw.filter((s) => !s.cancelledAt), [allSalesRaw]);
  const { expenses: allExpenses } = useExpenses();
  const { products: allProducts } = useProducts();
  const { branches: allBranches } = useBranches();
  const { appUser } = useAuth();

  // Rango de fechas por defecto: últimos 30 días
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');

  React.useEffect(() => {
    if (appUser?.role !== 'admin' && appUser?.branch) {
      setSelectedBranch(appUser.branch);
    }
  }, [appUser]);

  // Mapa rápido de productos por ID para buscar sus costos
  const productCostMap = React.useMemo(() => {
    const map = new Map<string, number>();
    allProducts.forEach((p) => {
      map.set(p.id, p.cost ?? 0);
    });
    return map;
  }, [allProducts]);

  // Costo de una línea vendida: manda el que quedó congelado en la venta. Solo
  // si la línea no lo trae (ventas anteriores a esa columna) se recurre al costo
  // actual del catálogo — que además solo tiene productos activos, así que un
  // producto archivado o borrado caería en 0 y regalaría margen.
  const costoDeLinea = React.useCallback(
    (item: CartItem) => item.cost ?? productCostMap.get(item.product.id) ?? 0,
    [productCostMap]
  );

  // Ingreso y costo de una venta entera, para la ganancia. Las ventas rápidas sin
  // costo no hay con qué calcularlas: salen del ingreso (su base sin ITBIS) y no
  // suman costo. Contarlas como ingreso con costo 0 inflaría la ganancia.
  const ingresoDeVenta = React.useCallback(
    (sale: Sale) => (sale.items ?? []).reduce(
      (a, item) => (isUncostedQuick(item) ? a - lineBase(item, !!sale.itbisIncluded, ITBIS_RATE) : a),
      sale.subtotal
    ),
    []
  );
  const costoDeVenta = React.useCallback(
    (sale: Sale) => (sale.items ?? []).reduce(
      (a, item) => (isUncostedQuick(item) ? a : a + item.quantity * costoDeLinea(item)),
      0
    ),
    [costoDeLinea]
  );

  // Abonos vigentes: dicen cuándo se cobró cada pedazo de las ventas a crédito
  // y financiadas. Se recargan con las ventas, porque cobrar o anular un abono
  // también cambia la venta.
  const [abonos, setAbonos] = React.useState<AbonoCobrado[]>([]);
  React.useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const filas = await fetchAllRows((desde, hasta) =>
          supabase
            .from('credit_payments')
            .select(ABONO_COBRADO_SELECT)
            .is('voided_at', null)
            .order('id', { ascending: true })
            .range(desde, hasta)
        );
        if (!cancelado) setAbonos(filas.map(rowToAbonoCobrado));
      } catch {
        // Sin abonos, lo cobrado de cada venta a plazos cae el día de la venta:
        // se pierde la fecha del cobro, no el monto.
        if (!cancelado) setAbonos([]);
      }
    })();
    return () => { cancelado = true; };
  }, [allSalesRaw]);

  const enRango = React.useCallback(
    (d: Date) => {
      if (!date?.from) return true;
      const fromDate = new Date(date.from);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = date.to ? new Date(date.to) : new Date(date.from);
      toDate.setHours(23, 59, 59, 999);
      return d >= fromDate && d <= toDate;
    },
    [date]
  );

  // Ventas de la sucursal, de cualquier fecha: el abono de hoy puede ser de una
  // venta de hace meses.
  const branchSales = React.useMemo(() => {
    if (appUser?.role !== 'admin') return allSales.filter((s) => s.branchId === appUser?.branch);
    return selectedBranch === 'all' ? allSales : allSales.filter((s) => s.branchId === selectedBranch);
  }, [allSales, selectedBranch, appUser]);

  // Ventas hechas en el rango: para la cantidad vendida y el aviso de rápidas sin costo.
  const filteredSales = React.useMemo(
    () => branchSales.filter((s) => enRango(new Date(s.createdAt))),
    [branchSales, enRango]
  );

  // Lo cobrado en el rango. Las de contado, enteras el día de la venta. Las de
  // crédito y financiadas, la parte que cubre cada abono, el día del abono: no
  // se gana el artículo hasta que el cliente lo paga.
  const cobradas = React.useMemo(
    () => realizaciones(branchSales, abonos).filter((r) => enRango(new Date(r.date))),
    [branchSales, abonos, enRango]
  );

  // Margen de las ventas a plazos que falta por cobrar, a hoy: irá entrando al
  // reporte con cada abono.
  const porCobrar = React.useMemo(() => {
    let margen = 0;
    let ventas = 0;
    branchSales.forEach((sale) => {
      const pendiente = 1 - fraccionCobrada(sale);
      if (pendiente < 0.0001) return;
      ventas += 1;
      margen += (ingresoDeVenta(sale) - costoDeVenta(sale)) * pendiente;
    });
    return { margen, ventas };
  }, [branchSales, ingresoDeVenta, costoDeVenta]);

  // Filtrado de Gastos por Sucursal y Fecha
  const filteredExpenses = React.useMemo(() => {
    let expenses = allExpenses;

    // Filtrar por sucursal
    if (appUser?.role !== 'admin') {
      expenses = expenses.filter((e) => e.branchId === appUser?.branch);
    } else if (selectedBranch !== 'all') {
      expenses = expenses.filter((e) => e.branchId === selectedBranch);
    }

    // Filtrar por fecha
    if (date?.from) {
      const fromDate = new Date(date.from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = date.to ? new Date(date.to) : new Date(date.from);
      toDate.setHours(23, 59, 59, 999);

      expenses = expenses.filter((e) => {
        const eDate = new Date(e.date);
        return eDate >= fromDate && eDate <= toDate;
      });
    }

    return expenses;
  }, [allExpenses, selectedBranch, date, appUser]);

  // --- Cálculos Financieros ---
  const totals = React.useMemo(() => {
    let subtotalRevenue = 0; // Excluimos ITBIS de los ingresos para la ganancia pura
    let totalCogs = 0; // Cost of Goods Sold (Costo de Compra de lo vendido)
    // Ventas rápidas sin costo vendidas en el rango: ya quedan fuera del ingreso
    // y del costo (ingresoDeVenta/costoDeVenta); se cuentan aparte para el aviso.
    let uncostedQuickCount = 0;
    let uncostedQuickAmount = 0;

    cobradas.forEach(({ sale, fraction }) => {
      subtotalRevenue += ingresoDeVenta(sale) * fraction;
      totalCogs += costoDeVenta(sale) * fraction;
    });

    filteredSales.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        if (!isUncostedQuick(item)) return;
        uncostedQuickCount += 1;
        uncostedQuickAmount += item.quantity * quickUnitPrice(item);
      });
    });

    const totalExpensesSum = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const grossProfit = subtotalRevenue - totalCogs;
    const netProfit = grossProfit - totalExpensesSum;
    const netMarginPercent = subtotalRevenue > 0 ? (netProfit / subtotalRevenue) * 100 : 0;

    return {
      revenue: subtotalRevenue,
      cogs: totalCogs,
      grossProfit,
      expenses: totalExpensesSum,
      netProfit,
      margin: netMarginPercent,
      uncostedQuickCount,
      uncostedQuickAmount,
    };
  }, [cobradas, filteredSales, filteredExpenses, ingresoDeVenta, costoDeVenta]);

  // --- Agrupación para el Gráfico ---
  const chartData = React.useMemo(() => {
    const dailyData: Record<string, { key: string; name: string; Ventas: number; Gastos: number; Ganancia: number }> = {};
    const dia = (d: Date) => {
      const key = format(d, 'yyyy-MM-dd');
      if (!dailyData[key]) {
        dailyData[key] = { key, name: format(d, 'dd MMM', { locale: es }), Ventas: 0, Gastos: 0, Ganancia: 0 };
      }
      return dailyData[key];
    };

    // Misma regla que en los totales: lo cobrado ese día, sin las rápidas sin costo.
    cobradas.forEach(({ sale, date: cobro, fraction }) => {
      const d = dia(new Date(cobro));
      const ingreso = ingresoDeVenta(sale);
      d.Ventas += ingreso * fraction;
      // Ganancia bruta diaria estimada
      d.Ganancia += (ingreso - costoDeVenta(sale)) * fraction;
    });

    // Añadir gastos a cada día correspondiente
    filteredExpenses.forEach((exp) => {
      const d = dia(new Date(exp.date));
      d.Gastos += exp.amount;
      d.Ganancia -= exp.amount;
    });

    // Los abonos de ventas viejas llegan fuera de orden: se ordena por día.
    return Object.values(dailyData).sort((a, b) => a.key.localeCompare(b.key));
  }, [cobradas, filteredExpenses, ingresoDeVenta, costoDeVenta]);

  // --- Rentabilidad por Producto ---
  const productProfitability = React.useMemo(() => {
    const productStats: Record<string, {
      name: string;
      qty: number;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    }> = {};

    // Las líneas de productos ya borrados no tienen product_id: se agrupan
    // por nombre para que no caigan todas juntas bajo una sola fila. Las
    // rápidas con costo se agrupan por su descripción normalizada, como en
    // Más vendidos, para que "Cable" y "cable " sean una sola fila.
    const filaDe = (item: CartItem) => {
      const pId = item.isQuick ? topProductKey(item) : item.product.id || `sin-id:${item.product.name}`;
      if (!productStats[pId]) {
        productStats[pId] = {
          name: item.product.name,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          margin: 0
        };
      }
      return productStats[pId];
    };

    // La cantidad es lo que salió en el rango. Venta, costo y ganancia son lo
    // cobrado en el rango: en una venta a plazos, la parte que ya se pagó.
    // Las rápidas sin costo no tienen rentabilidad que mostrar: van en el aviso.
    filteredSales.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        if (isUncostedQuick(item)) return;
        filaDe(item).qty += item.quantity;
      });
    });

    cobradas.forEach(({ sale, fraction }) => {
      (sale.items ?? []).forEach((item) => {
        if (isUncostedQuick(item)) return;
        const itemPrice = item.customPrice ?? item.product.price;
        const stats = filaDe(item);
        stats.revenue += item.quantity * itemPrice * fraction;
        stats.cost += item.quantity * costoDeLinea(item) * fraction;
        stats.profit = stats.revenue - stats.cost;
        stats.margin = stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;
      });
    });

    return Object.values(productStats).sort((a, b) => b.profit - a.profit);
  }, [filteredSales, cobradas, costoDeLinea]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader title="Reporte de Ganancias Netas">
          <ExportButton
            filename="reporte_ganancias_netas"
            rows={productProfitability}
            columns={[
              { header: 'Producto', value: (row) => row.name },
              { header: 'Cant. Vendida', value: (row) => formatQty(row.qty) },
              { header: 'Ventas Totales (RD$)', value: (row) => row.revenue },
              { header: 'Costo Total (RD$)', value: (row) => row.cost },
              { header: 'Ganancia Bruta (RD$)', value: (row) => row.profit },
              { header: 'Margen (%)', value: (row) => `${row.margin.toFixed(1)}%` },
            ]}
          />
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3">
          {/* Selector de Sucursal (Solo Admin) */}
          {appUser?.role === 'admin' && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-[180px] bg-card border-muted-foreground/20">
                <Store className="mr-2 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {allBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.name}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Selector de Rango de Fechas */}
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

      {totals.uncostedQuickCount > 0 && (
        <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
            <FileWarning className="h-4 w-4" />
            Ventas rápidas sin costo: {totals.uncostedQuickCount} línea{totals.uncostedQuickCount === 1 ? '' : 's'} por {formatCurrency(totals.uncostedQuickAmount)}, fuera del cálculo de ganancia
          </div>
        </div>
      )}

      {/* --- KPIs en fila --- */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ventas (Subtotal)</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(totals.revenue)}</div>
            <p className="text-2xs text-muted-foreground mt-1">Cobrado sin impuestos</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Costo de Compra</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(totals.cogs)}</div>
            <p className="text-2xs text-muted-foreground mt-1">Valor de adquisición de stock</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gastos Operativos</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(totals.expenses)}</div>
            <p className="text-2xs text-muted-foreground mt-1">Egresos registrados en fecha</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-emerald-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ganancia Neta</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-500">{formatCurrency(totals.netProfit)}</div>
            <p className="text-2xs text-muted-foreground mt-1">Utilidad final disponible</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Margen de Utilidad</CardTitle>
            <Percent className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{totals.margin.toFixed(1)}%</div>
            <p className="text-2xs text-muted-foreground mt-1">Porcentaje de retorno de ventas</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Las ventas a crédito y financiadas suman su ganancia a medida que el cliente paga, en la fecha de cada abono.
        {porCobrar.ventas > 0 && (
          <>
            {' '}Quedan <span className="font-semibold text-foreground">{formatCurrency(porCobrar.margen)}</span> de
            ganancia por cobrar en {porCobrar.ventas} {porCobrar.ventas === 1 ? 'venta' : 'ventas'}.
          </>
        )}
        {' '}El interés y la mora están en Ganancias de Financiamiento.
      </p>

      {/* --- Gráfico --- */}
      <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Comparativa Financiera (Ventas vs Gastos vs Ganancias)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" fontSize={11} stroke="#888888" tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} stroke="#888888" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Ventas" fill="#10b981" radius={[3, 3, 0, 0]} name="Ingresos (Subtotal)" />
                  <Bar dataKey="Gastos" fill="#f97316" radius={[3, 3, 0, 0]} name="Gastos Operativos" />
                  <Bar dataKey="Ganancia" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Ganancia Est." />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No hay movimientos en este rango de fechas.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Tabla de Rentabilidad por Producto --- */}
      <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Tabla de Rentabilidad por Producto</CardTitle>
          <p className="text-2xs text-muted-foreground">
            La cantidad es lo vendido en el rango; venta, costo y ganancia son lo cobrado en el rango.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-center">Cantidad Vendida</TableHead>
                  <TableHead className="text-right">Venta (Subtotal)</TableHead>
                  <TableHead className="text-right">Costo Adquisición</TableHead>
                  <TableHead className="text-right">Ganancia Bruta</TableHead>
                  <TableHead className="text-right">Margen (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productProfitability.length > 0 ? (
                  productProfitability.map((item, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/10">
                      <TableCell className="font-semibold">{item.name}</TableCell>
                      <TableCell className="text-center">{formatQty(item.qty)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.revenue)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatCurrency(item.cost)}</TableCell>
                      <TableCell className="text-right text-emerald-500 font-bold">{formatCurrency(item.profit)}</TableCell>
                      <TableCell className="text-right text-blue-500 font-semibold">{item.margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No se han vendido productos en el rango de fechas.
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
