'use client';

import * as React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/auth-provider';
import { useModules } from '@/context/modules-provider';
import { useSales } from '@/context/sales-provider';
import { useExpenses } from '@/context/expense-provider';
import { useProducts } from '@/context/product-provider';
import { useLoans } from '@/context/loan-provider';
import { useBranches } from '@/context/branch-provider';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { 
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend 
} from 'recharts';
import { 
  TrendingUp, DollarSign, ArrowDownRight, Wallet, Package, ArrowUpRight, Percent, FileText, CheckSquare, ListFilter, Store, ArrowRight
} from 'lucide-react';

export default function ReportsDashboardPage() {
  const { appUser } = useAuth();
  const { isModuleEnabled } = useModules();
  const { sales: allSales } = useSales();
  const { expenses: allExpenses } = useExpenses();
  const { products: allProducts } = useProducts();
  const { loans: allLoans } = useLoans();
  const { branches: allBranches } = useBranches();

  const [selectedBranch, setSelectedBranch] = React.useState('all');

  React.useEffect(() => {
    if (appUser?.role !== 'admin' && appUser?.branch) {
      setSelectedBranch(appUser.branch);
    }
  }, [appUser]);

  // --- Determinar módulos activos ---
  const hasPos = isModuleEnabled('pos');
  const hasSales = isModuleEnabled('sales');
  const hasExpenses = isModuleEnabled('expenses');
  const hasCredit = isModuleEnabled('credit');
  const hasFinancing = isModuleEnabled('financing');
  const hasPrestamos = isModuleEnabled('prestamos');

  // --- Filtrado por Sucursal ---
  const filteredSales = React.useMemo(() => {
    if (appUser?.role !== 'admin') {
      return allSales.filter((s) => s.branchId === appUser?.branch);
    }
    return selectedBranch === 'all' ? allSales : allSales.filter((s) => s.branchId === selectedBranch);
  }, [allSales, selectedBranch, appUser]);

  const filteredExpenses = React.useMemo(() => {
    if (appUser?.role !== 'admin') {
      return allExpenses.filter((e) => e.branchId === appUser?.branch);
    }
    return selectedBranch === 'all' ? allExpenses : allExpenses.filter((e) => e.branchId === selectedBranch);
  }, [allExpenses, selectedBranch, appUser]);

  const filteredLoans = React.useMemo(() => {
    if (appUser?.role !== 'admin') {
      return allLoans.filter((l) => l.branchId === appUser?.branch);
    }
    return selectedBranch === 'all' ? allLoans : allLoans.filter((l) => l.branchId === selectedBranch);
  }, [allLoans, selectedBranch, appUser]);

  // --- Cálculos Consolidados ---
  const stats = React.useMemo(() => {
    // 1. Ingresos totales (Ventas)
    const salesRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0);
    const salesCount = filteredSales.length;

    // 2. Costo de venta y Ganancia Estimada
    let totalCogs = 0;
    filteredSales.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        // Buscamos el costo actual
        const prod = allProducts.find((p) => p.id === item.product.id);
        totalCogs += item.quantity * (prod?.cost ?? 0);
      });
    });
    const subtotalRevenue = filteredSales.reduce((sum, s) => sum + s.subtotal, 0);
    const grossProfit = subtotalRevenue - totalCogs;

    // 3. Gastos
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

    // 4. Ganancia Neta
    const netProfit = grossProfit - totalExpenses;

    // 5. Cuentas por Cobrar (Crédito + Financiamientos)
    let pendingReceivables = 0;
    filteredSales.forEach((sale) => {
      if (sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing') {
        const remaining = sale.total - sale.amountPaid;
        if (remaining > 0) pendingReceivables += remaining;
      }
    });

    // 6. Inventario Valorado
    const totalStockValuation = allProducts.reduce((sum, p) => sum + (p.stock * (p.cost ?? 0)), 0);
    const totalStockCount = allProducts.reduce((sum, p) => sum + p.stock, 0);

    // 7. Préstamos Otorgados y Saldo Pendiente
    let loansPrincipalIssued = 0;
    let loansOutstandingBalance = 0;
    const activeLoans = filteredLoans.filter(l => l.status === 'active');
    activeLoans.forEach((l) => {
      loansPrincipalIssued += l.principal;
      // Saldo pendiente: capital original + interés - lo pagado
      const totalToPay = l.principal + (l.principal * (l.interestRate / 100));
      // Cálculo aproximado en base a cuotas restantes
      const paid = (l.installments ?? [])
        .filter((inst) => inst.status === 'paid')
        .reduce((sum, inst) => sum + inst.amount, 0);
      const remaining = totalToPay - paid;
      if (remaining > 0) loansOutstandingBalance += remaining;
    });

    return {
      revenue: salesRevenue,
      salesCount,
      netProfit,
      expenses: totalExpenses,
      receivables: pendingReceivables,
      inventoryValuation: totalStockValuation,
      inventoryItems: totalStockCount,
      loansIssued: loansPrincipalIssued,
      loansBalance: loansOutstandingBalance,
      activeLoansCount: activeLoans.length,
    };
  }, [filteredSales, filteredExpenses, filteredLoans, allProducts]);

  // --- Gráfico de Barra Comparativo ---
  const chartData = React.useMemo(() => {
    const data = [
      { name: 'Ingresos POS', Monto: stats.revenue, fill: '#10b981' },
      { name: 'Gastos', Monto: stats.expenses, fill: '#f97316' },
    ];

    if (hasCredit || hasFinancing) {
      data.push({ name: 'Por Cobrar', Monto: stats.receivables, fill: '#3b82f6' });
    }

    if (hasPrestamos) {
      data.push({ name: 'Saldo Préstamos', Monto: stats.loansBalance, fill: '#8b5cf6' });
    }

    data.push({ name: 'Valo. Inventario', Monto: stats.inventoryValuation, fill: '#eab308' });

    return data;
  }, [stats, hasCredit, hasFinancing, hasPrestamos]);

  return (
    <div className="space-y-6">
      {/* Cabecera y Selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader title="Panel Consolidado de Reportes" />

        {appUser?.role === 'admin' && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[200px] bg-card border-muted-foreground/20">
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
      </div>

      {/* --- Indicadores Principales Consolidados --- */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {hasSales && (
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="text-2xs uppercase font-bold tracking-wider">Ingresos Totales (POS)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatCurrency(stats.revenue)}</div>
              <p className="text-3xs text-muted-foreground mt-1">Acumulado de {stats.salesCount} transacciones</p>
            </CardContent>
          </Card>
        )}

        {hasExpenses && (
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="text-2xs uppercase font-bold tracking-wider">Egresos Totales</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-orange-500">{formatCurrency(stats.expenses)}</div>
              <p className="text-3xs text-muted-foreground mt-1">Gastos de operación del negocio</p>
            </CardContent>
          </Card>
        )}

        {(hasCredit || hasFinancing) && (
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
            <CardHeader className="pb-1">
              <CardDescription className="text-2xs uppercase font-bold tracking-wider">Cuentas por Cobrar</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-blue-500">{formatCurrency(stats.receivables)}</div>
              <p className="text-3xs text-muted-foreground mt-1">Ventas a crédito pendientes de cobro</p>
            </CardContent>
          </Card>
        )}

        {hasPrestamos && (
          <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-indigo-500/5 to-transparent">
            <CardHeader className="pb-1">
              <CardDescription className="text-2xs uppercase font-bold tracking-wider">Cartera de Préstamos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-indigo-500">{formatCurrency(stats.loansBalance)}</div>
              <p className="text-3xs text-muted-foreground mt-1">{stats.activeLoansCount} préstamos financieros activos</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* --- Gráfico Comparativo Principal --- */}
      <div className="grid gap-6 md:grid-cols-7">
        <Card className="md:col-span-4 bg-card/40 backdrop-blur-sm border-muted/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Resumen General de Activos y Flujos</CardTitle>
            <CardDescription className="text-xs">Comparación de saldos en sucursales activas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <XAxis dataKey="name" fontSize={11} stroke="#888888" tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} stroke="#888888" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="Monto" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* --- Resumen Rápido de Estado --- */}
        <Card className="md:col-span-3 bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-emerald-500/5 to-transparent">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Ganancia Neta Estimada</CardTitle>
            <CardDescription className="text-xs">Utilidad calculada (Ingresos POS - Costos - Gastos)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-3xl font-extrabold text-emerald-500">
              {formatCurrency(stats.netProfit)}
            </div>
            
            <div className="space-y-2 pt-2 border-t text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor del Inventario (Costo):</span>
                <span className="font-bold">{formatCurrency(stats.inventoryValuation)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Productos en Stock:</span>
                <span className="font-bold">{stats.inventoryItems} unidades</span>
              </div>
              {hasPrestamos && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital Colocado Préstamos:</span>
                  <span className="font-bold">{formatCurrency(stats.loansIssued)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Acceso Rápido a Reportes Específicos --- */}
      <div>
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Reportes Detallados</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          
          {hasSales && (
            <Link href="/reports/sales-summary">
              <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group">
                <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm font-bold">Ventas</CardTitle>
                    <CardDescription className="text-3xs mt-1">Análisis de ingresos y tickets</CardDescription>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </CardHeader>
              </Card>
            </Link>
          )}

          {hasSales && (
            <Link href="/reports/ganancias">
              <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group bg-gradient-to-br from-emerald-500/5 to-transparent">
                <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm font-bold text-emerald-500">Ganancias</CardTitle>
                    <CardDescription className="text-3xs mt-1">Margen de utilidad neto</CardDescription>
                  </div>
                  <ArrowRight className="h-4 w-4 text-emerald-500 group-hover:translate-x-1 transition-transform" />
                </CardHeader>
              </Card>
            </Link>
          )}

          <Link href="/reports/top-products">
            <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group">
              <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm font-bold">Más Vendidos</CardTitle>
                  <CardDescription className="text-3xs mt-1">Rotación de productos y stock</CardDescription>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardHeader>
            </Card>
          </Link>

          {(hasCredit || hasFinancing) && (
            <Link href="/reports/receivables">
              <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group">
                <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm font-bold">Cuentas por Cobrar</CardTitle>
                    <CardDescription className="text-3xs mt-1">Vencimientos y saldos pendientes</CardDescription>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </CardHeader>
              </Card>
            </Link>
          )}

          <Link href="/reports/inventory">
            <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group">
              <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm font-bold">Valor de Inventario</CardTitle>
                  <CardDescription className="text-3xs mt-1">Valorización total y stock</CardDescription>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/taxes">
            <Card className="hover:bg-muted/30 transition-all cursor-pointer border-muted/50 group">
              <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm font-bold">Impuestos</CardTitle>
                  <CardDescription className="text-3xs mt-1">ITBIS recaudado en facturación</CardDescription>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardHeader>
            </Card>
          </Link>
          
        </div>
      </div>
    </div>
  );
}
