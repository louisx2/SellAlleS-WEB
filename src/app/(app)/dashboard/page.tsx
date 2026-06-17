'use client';

import { useEffect, useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { DollarSign, Hash } from 'lucide-react';
import { SalesChart } from '@/components/reports/sales-chart';
import { RecentSales } from '@/components/reports/recent-sales';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { List, CreditCard, ClipboardList, AlertTriangle } from 'lucide-react';
import { useSales } from '@/context/sales-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';

export default function DashboardPage() {
  const { sales: allSales } = useSales();
  const { branches: allBranches } = useBranches();
  const { appUser } = useAuth();
  
  const [selectedBranch, setSelectedBranch] = useState('all');

  useEffect(() => {
    if (appUser?.role !== 'admin' && appUser?.branch) {
      setSelectedBranch(appUser.branch);
    }
  }, [appUser]);

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const salesToday = useMemo(() => {
    return allSales.filter(sale => {
      const saleDate = new Date(sale.createdAt);
      saleDate.setHours(0, 0, 0, 0);
      return saleDate.getTime() === today.getTime();
    });
  }, [allSales, today]);

  const filteredSales = useMemo(() => {
    if (selectedBranch === 'all' && appUser?.role === 'admin') {
      return salesToday;
    }
    return salesToday.filter(sale => sale.branchId === selectedBranch);
  }, [salesToday, selectedBranch, appUser?.role]);

  const totalRevenueToday = filteredSales
    .filter(sale => sale.paymentStatus === 'paid')
    .reduce((acc, sale) => acc + sale.amountPaid, 0);

  const totalCreditToday = filteredSales
    .filter(sale => sale.paymentStatus === 'credit')
    .reduce((acc, sale) => acc + sale.total, 0);
  
  const creditTransactionsToday = filteredSales.filter(sale => sale.paymentStatus === 'credit').length;

  const salesByBranch = useMemo(() => {
    const salesData: Record<string, number> = {};
    salesToday.forEach(sale => { // Show all branches for admin, regardless of filter
        if (!salesData[sale.branchId]) {
            salesData[sale.branchId] = 0;
        }
        salesData[sale.branchId] += sale.total;
    });
    return salesData;
  }, [salesToday]);

  const totalSalesToday = filteredSales.length;

  const salesByHour = useMemo(() => {
    const salesByHourData: Record<string, number> = {};
    for (let i = 0; i < 24; i++) {
        const hour = i.toString().padStart(2, '0');
        salesByHourData[`${hour}:00`] = 0;
    }
    filteredSales.forEach(sale => {
        const hour = new Date(sale.createdAt).getHours().toString().padStart(2, '0');
        const key = `${hour}:00`;
        if (salesByHourData[key] !== undefined) {
          salesByHourData[key] += sale.total;
        }
    });
    return salesByHourData;
  }, [filteredSales]);

  const chartData = Object.keys(salesByHour).map(hour => ({
    name: hour,
    total: salesByHour[hour],
  }));

  const recentSalesToday = filteredSales.slice(0, 5);

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 mb-6">
        <div>
          <PageHeader title="Vista General de Hoy" />
          {appUser?.role === 'admin' && (
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger className="w-full sm:w-[240px]">
                      <SelectValue placeholder="Filtrar por sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="all">Todas las sucursales</SelectItem>
                      {allBranches.map(branch => (
                          <SelectItem key={branch.id} value={branch.name}>{branch.name}</SelectItem>
                      ))}
                  </SelectContent>
              </Select>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos de Hoy (Contado)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenueToday)}</div>
            <p className="text-xs text-muted-foreground">
              {selectedBranch === 'all' && appUser?.role === 'admin' ? 'En todas las sucursales' : `En ${selectedBranch}`}
            </p>
          </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Ventas de Hoy</CardTitle>
                <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">+{totalSalesToday}</div>
                <p className="text-xs text-muted-foreground">{totalSalesToday === 1 ? 'transacción hoy' : 'transacciones hoy'}</p>
            </CardContent>
        </Card>
        {appUser?.role === 'admin' && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ventas por Sucursal (Hoy)</CardTitle>
              <List className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {Object.keys(salesByBranch).length > 0 ? (
                <div className="space-y-1 text-sm">
                  {Object.entries(salesByBranch).map(([branch, total]) => (
                    <div key={branch} className="flex justify-between">
                      <span className="text-muted-foreground">{branch}</span>
                      <span className="font-medium">{formatCurrency(total)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No hay ventas hoy.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Crédito Otorgado Hoy</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalCreditToday)}</div>
            <p className="text-xs text-muted-foreground">en ventas a crédito</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transacciones a Crédito</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+{creditTransactionsToday}</div>
            <p className="text-xs text-muted-foreground">transacciones a crédito hoy</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cuentas Atrasadas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(0)}</div>
            <p className="text-xs text-muted-foreground">en créditos vencidos</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
           <CardHeader>
            <CardTitle>Ventas por Hora</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={chartData} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
           <CardHeader>
            <CardTitle>Últimas Ventas de Hoy</CardTitle>
          </CardHeader>
          <CardContent>
            {recentSalesToday.length > 0 ? (
                <RecentSales sales={recentSalesToday} />
            ) : (
                <p className="text-sm text-muted-foreground text-center pt-8">No hay ventas para mostrar hoy.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    