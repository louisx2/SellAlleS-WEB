'use client';

import { useEffect, useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { DollarSign, Hash, CreditCard, ClipboardList, Settings2 } from 'lucide-react';
import { RecentSales } from '@/components/reports/recent-sales';
import { FlexChart } from '@/components/dashboard/flex-chart';
import { DashboardConfigDialog } from '@/components/dashboard/dashboard-config-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSales } from '@/context/sales-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import {
  loadDashboardConfig, saveDashboardConfig, defaultDashboardConfig, type DashboardConfig,
} from '@/lib/dashboard-config';

function KpiCard({ title, value, subtitle, icon: Icon, accentClass }: {
  title: string; value: string; subtitle: string; icon: React.ElementType; accentClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${accentClass ?? 'text-muted-foreground'}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accentClass ?? ''}`}>{value}</div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { sales: allSales } = useSales();
  const { branches: allBranches } = useBranches();
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';

  const [selectedBranch, setSelectedBranch] = useState('all');
  const [config, setConfig] = useState<DashboardConfig>(defaultDashboardConfig());
  const [configOpen, setConfigOpen] = useState(false);

  // Config persistida por empresa + usuario (localStorage).
  useEffect(() => {
    setConfig(loadDashboardConfig(appUser?.companyId, appUser?.id));
  }, [appUser?.companyId, appUser?.id]);

  const handleSaveConfig = (c: DashboardConfig) => {
    setConfig(c);
    saveDashboardConfig(c, appUser?.companyId, appUser?.id);
  };

  useEffect(() => {
    if (!isAdmin && appUser?.branch) setSelectedBranch(appUser.branch);
  }, [isAdmin, appUser?.branch]);

  const today = useMemo(() => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; }, []);

  const salesToday = useMemo(() => allSales.filter((s) => {
    const d = new Date(s.createdAt); d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }), [allSales, today]);

  const filteredSales = useMemo(() => {
    if (selectedBranch === 'all' && isAdmin) return salesToday;
    return salesToday.filter((s) => s.branchId === selectedBranch);
  }, [salesToday, selectedBranch, isAdmin]);

  const totalRevenueToday = filteredSales.filter((s) => s.paymentStatus === 'paid').reduce((a, s) => a + s.amountPaid, 0);
  const totalCreditToday = filteredSales.filter((s) => s.paymentStatus === 'credit').reduce((a, s) => a + s.total, 0);
  const creditTxToday = filteredSales.filter((s) => s.paymentStatus === 'credit').length;
  const totalSalesToday = filteredSales.length;

  const byHourData = useMemo(() => {
    const acc: Record<string, number> = {};
    for (let i = 0; i < 24; i++) acc[`${String(i).padStart(2, '0')}:00`] = 0;
    filteredSales.forEach((s) => {
      const k = `${String(new Date(s.createdAt).getHours()).padStart(2, '0')}:00`;
      if (acc[k] !== undefined) acc[k] += s.total;
    });
    return Object.entries(acc).map(([name, total]) => ({ name, total }));
  }, [filteredSales]);

  const byBranchData = useMemo(() => {
    const acc: Record<string, number> = {};
    salesToday.forEach((s) => { acc[s.branchId] = (acc[s.branchId] ?? 0) + s.total; });
    return Object.entries(acc).map(([name, total]) => ({ name, total }));
  }, [salesToday]);

  const v = config.visible;
  const anyKpi = v.kpi_revenue || v.kpi_sales_count || v.kpi_credit || v.kpi_credit_tx;

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 mb-6">
        <div>
          <PageHeader title="Vista General de Hoy" />
          {isAdmin && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-full sm:w-[240px]">
                <SelectValue placeholder="Filtrar por sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {allBranches.map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button variant="outline" onClick={() => setConfigOpen(true)}>
          <Settings2 className="mr-2 h-4 w-4" />
          Configurar
        </Button>
      </div>

      {anyKpi && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {v.kpi_revenue && (
            <KpiCard title="Ingresos de Hoy (Contado)" value={formatCurrency(totalRevenueToday)}
              subtitle={selectedBranch === 'all' && isAdmin ? 'En todas las sucursales' : `En ${selectedBranch}`}
              icon={DollarSign} />
          )}
          {v.kpi_sales_count && (
            <KpiCard title="Ventas de Hoy" value={`+${totalSalesToday}`}
              subtitle={totalSalesToday === 1 ? 'transacción hoy' : 'transacciones hoy'} icon={Hash} />
          )}
          {v.kpi_credit && (
            <KpiCard title="Crédito Otorgado Hoy" value={formatCurrency(totalCreditToday)}
              subtitle="en ventas a crédito" icon={CreditCard} />
          )}
          {v.kpi_credit_tx && (
            <KpiCard title="Transacciones a Crédito" value={`+${creditTxToday}`}
              subtitle="a crédito hoy" icon={ClipboardList} />
          )}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-7">
        {v.chart_by_hour && (
          <Card className="lg:col-span-4 min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Ventas por Hora</CardTitle></CardHeader>
            <CardContent>
              <FlexChart type={config.charts.chart_by_hour ?? 'bar'} data={byHourData} />
            </CardContent>
          </Card>
        )}
        {v.recent_sales && (
          <Card className="lg:col-span-3 min-w-0">
            <CardHeader><CardTitle>Últimas Ventas de Hoy</CardTitle></CardHeader>
            <CardContent>
              {filteredSales.length > 0 ? (
                <RecentSales sales={filteredSales.slice(0, 5)} />
              ) : (
                <p className="text-sm text-muted-foreground text-center pt-8">No hay ventas para mostrar hoy.</p>
              )}
            </CardContent>
          </Card>
        )}
        {isAdmin && v.chart_by_branch && (
          <Card className="lg:col-span-4 min-w-0 overflow-hidden">
            <CardHeader><CardTitle>Ventas por Sucursal (Hoy)</CardTitle></CardHeader>
            <CardContent>
              <FlexChart type={config.charts.chart_by_branch ?? 'bar'} data={byBranchData} />
            </CardContent>
          </Card>
        )}
      </div>

      <DashboardConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        isAdmin={isAdmin}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
