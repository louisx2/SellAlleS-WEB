'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, DollarSign, TrendingUp, ArrowDownRight, ArrowUpRight, Percent, Store, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { useSales } from '@/context/sales-provider';
import { useExpenses } from '@/context/expense-provider';
import { useProducts } from '@/context/product-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { ExportButton } from '@/components/reports/export-button';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function GananciasReportPage() {
  const { sales: allSales } = useSales();
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

  // Filtrado de Ventas por Sucursal y Fecha
  const filteredSales = React.useMemo(() => {
    let sales = allSales;
    
    // Filtrar por sucursal
    if (appUser?.role !== 'admin') {
      sales = sales.filter((s) => s.branchId === appUser?.branch);
    } else if (selectedBranch !== 'all') {
      sales = sales.filter((s) => s.branchId === selectedBranch);
    }

    // Filtrar por fecha
    if (date?.from) {
      const fromDate = new Date(date.from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = date.to ? new Date(date.to) : new Date(date.from);
      toDate.setHours(23, 59, 59, 999);

      sales = sales.filter((s) => {
        const sDate = new Date(s.createdAt);
        return sDate >= fromDate && sDate <= toDate;
      });
    }

    return sales;
  }, [allSales, selectedBranch, date, appUser]);

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

    filteredSales.forEach((sale) => {
      subtotalRevenue += sale.subtotal;
      (sale.items ?? []).forEach((item) => {
        const productCost = productCostMap.get(item.product.id) || 0;
        totalCogs += item.quantity * productCost;
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
    };
  }, [filteredSales, filteredExpenses, productCostMap]);

  // --- Agrupación para el Gráfico ---
  const chartData = React.useMemo(() => {
    const dailyData: Record<string, { name: string; Ventas: number; Gastos: number; Ganancia: number }> = {};

    filteredSales.forEach((sale) => {
      const day = format(new Date(sale.createdAt), 'dd MMM', { locale: es });
      if (!dailyData[day]) {
        dailyData[day] = { name: day, Ventas: 0, Gastos: 0, Ganancia: 0 };
      }
      dailyData[day].Ventas += sale.subtotal;
      
      let saleCogs = 0;
      (sale.items ?? []).forEach((item) => {
        const cost = productCostMap.get(item.product.id) || 0;
        saleCogs += item.quantity * cost;
      });
      // Ganancia bruta diaria estimada
      dailyData[day].Ganancia += (sale.subtotal - saleCogs);
    });

    // Añadir gastos a cada día correspondiente
    filteredExpenses.forEach((exp) => {
      const day = format(new Date(exp.date), 'dd MMM', { locale: es });
      if (!dailyData[day]) {
        dailyData[day] = { name: day, Ventas: 0, Gastos: 0, Ganancia: 0 };
      }
      dailyData[day].Gastos += exp.amount;
      dailyData[day].Ganancia -= exp.amount;
    });

    // Retornamos ordenado por fecha aproximada
    return Object.values(dailyData);
  }, [filteredSales, filteredExpenses, productCostMap]);

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

    filteredSales.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        const pId = item.product.id;
        const pName = item.product.name;
        const pCost = productCostMap.get(pId) || 0;
        const itemPrice = item.customPrice ?? item.product.price;
        const itemRevenue = item.quantity * itemPrice;
        const itemCostTotal = item.quantity * pCost;

        if (!productStats[pId]) {
          productStats[pId] = {
            name: pName,
            qty: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
            margin: 0
          };
        }

        const stats = productStats[pId];
        stats.qty += item.quantity;
        stats.revenue += itemRevenue;
        stats.cost += itemCostTotal;
        stats.profit = stats.revenue - stats.cost;
        stats.margin = stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;
      });
    });

    return Object.values(productStats).sort((a, b) => b.profit - a.profit);
  }, [filteredSales, productCostMap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader title="Reporte de Ganancias Netas">
          <ExportButton
            filename="reporte_ganancias_netas"
            rows={productProfitability}
            columns={[
              { header: 'Producto', value: (row) => row.name },
              { header: 'Cant. Vendida', value: (row) => row.qty },
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

      {/* --- KPIs en fila --- */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ventas (Subtotal)</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(totals.revenue)}</div>
            <p className="text-2xs text-muted-foreground mt-1">Ingresos brutos sin impuestos</p>
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
                      <TableCell className="text-center">{item.qty}</TableCell>
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
