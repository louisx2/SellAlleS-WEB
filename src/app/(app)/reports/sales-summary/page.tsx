'use client';

import { useEffect, useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { DollarSign, Hash, Receipt } from 'lucide-react';
import { SalesChart } from '@/components/reports/sales-chart';
import { RecentSales } from '@/components/reports/recent-sales';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSales } from '@/context/sales-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';

export default function SalesSummaryReportPage() {
  const { sales: allSales } = useSales();
  const { branches: allBranches } = useBranches();
  const { appUser } = useAuth();
  const [selectedBranch, setSelectedBranch] = useState('all');

  useEffect(() => {
    if (appUser?.role !== 'admin' && appUser?.branch) {
      setSelectedBranch(appUser.branch);
    }
  }, [appUser]);

  const filteredSales = useMemo(() => {
    if (appUser?.role !== 'admin') {
      return allSales.filter(sale => sale.branchId === appUser?.branch);
    }
    if (selectedBranch === 'all') {
      return allSales;
    }
    return allSales.filter(sale => sale.branchId === selectedBranch);
  }, [allSales, selectedBranch, appUser]);

  const totalRevenue = filteredSales.reduce((acc, sale) => acc + sale.total, 0);
  const totalSales = filteredSales.length;
  const totalItbis = filteredSales.reduce((acc, sale) => acc + sale.itbisAmount, 0);

  const salesByDay = useMemo(() => {
    return filteredSales.reduce((acc, sale) => {
      const date = new Date(sale.createdAt).toLocaleDateString('es-DO', {
        month: 'short',
        day: 'numeric',
      });
      if (!acc[date]) {
        acc[date] = 0;
      }
      acc[date] += sale.total;
      return acc;
    }, {} as Record<string, number>);
  }, [filteredSales]);

  const chartData = Object.keys(salesByDay).map(date => ({
    name: date,
    total: salesByDay[date],
  })).reverse();


  return (
    <div>
      <div className="mb-6">
        <PageHeader title="Resumen de Ventas" />
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos Totales</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">de {totalSales} ventas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Ventas</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+{totalSales}</div>
            <p className="text-xs text-muted-foreground">transacciones completadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ITBIS Recaudado</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalItbis)}</div>
            <p className="text-xs text-muted-foreground">de productos gravados</p>
          </CardContent>
        </Card>
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
           <CardHeader>
            <CardTitle>Resumen de Ventas</CardTitle>
          </CardHeader>
          <CardContent>
             {filteredSales.length > 0 ? (
                <SalesChart data={chartData} />
              ) : (
                <p className="text-sm text-muted-foreground text-center pt-8">No hay datos de ventas para mostrar.</p>
              )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
           <CardHeader>
            <CardTitle>Ventas Recientes</CardTitle>
          </CardHeader>
          <CardContent>
             {filteredSales.length > 0 ? (
                <RecentSales sales={filteredSales.slice(0, 5)} />
              ) : (
                <p className="text-sm text-muted-foreground text-center pt-8">No hay ventas recientes para mostrar.</p>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    