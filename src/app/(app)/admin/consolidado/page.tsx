'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/reports/export-button';
import { formatCurrency } from '@/lib/utils';
import { FileBarChart, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  ConsolidatedDashboardConfigDialog, type AvailableCompany, type ExternalEntry,
} from '@/components/admin/consolidated-dashboard-config-dialog';
import type { ConsolidatedDashboardConfig } from '@/lib/types';

interface DashboardRow {
  company_id: string;
  company_name: string;
  branch_id: string | null;
  branch_name: string | null;
  revenue: number;
  subtotal_revenue: number;
  cogs: number;
  sales_count: number;
  expenses: number;
  receivables_pending: number;
  inventory_cost_value: number;
  inventory_units: number;
  loans_balance: number;
  loans_active_count: number;
}

const emptyConfig: ConsolidatedDashboardConfig = { companyIds: [], branchesByCompany: {} };

const numberRow = (r: any): DashboardRow => ({
  ...r,
  revenue: Number(r.revenue), subtotal_revenue: Number(r.subtotal_revenue), cogs: Number(r.cogs),
  sales_count: Number(r.sales_count), expenses: Number(r.expenses), receivables_pending: Number(r.receivables_pending),
  inventory_cost_value: Number(r.inventory_cost_value), inventory_units: Number(r.inventory_units),
  loans_balance: Number(r.loans_balance), loans_active_count: Number(r.loans_active_count),
});

export default function ConsolidatedDashboardPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [availableCompanies, setAvailableCompanies] = useState<AvailableCompany[]>([]);
  const [config, setConfig] = useState<ConsolidatedDashboardConfig>(emptyConfig);
  const [externalEntries, setExternalEntries] = useState<ExternalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  // El reporte solo existe una vez que el usuario presiona "Generar Reporte"
  // — la página no calcula nada al entrar.
  const [report, setReport] = useState<DashboardRow[] | null>(null);
  const [reportConfig, setReportConfig] = useState<ConsolidatedDashboardConfig>(emptyConfig);
  const [reportRange, setReportRange] = useState<DateRange | undefined>(undefined);

  const hasMultipleCompanies = !!(appUser?.companies && appUser.companies.length > 1);

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    const [{ data: companyRows }, { data: profileRow }, { data: entries }] = await Promise.all([
      supabase.rpc('get_my_admin_companies'),
      supabase.from('profiles').select('consolidated_dashboard_config').eq('id', appUser.id).maybeSingle(),
      supabase.from('dashboard_external_entries').select('*').eq('profile_id', appUser.id).order('created_at'),
    ]);
    const byCompany = new Map<string, AvailableCompany>();
    (companyRows ?? []).forEach((r: any) => {
      if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, { id: r.company_id, name: r.company_name, branches: [] });
      if (r.branch_id && r.branch_name) {
        const entry = byCompany.get(r.company_id)!;
        if (!entry.branches.some((b) => b.id === r.branch_id)) entry.branches.push({ id: r.branch_id, name: r.branch_name });
      }
    });
    setAvailableCompanies(Array.from(byCompany.values()));
    const savedConfig = (profileRow as any)?.consolidated_dashboard_config;
    setConfig(savedConfig && typeof savedConfig === 'object' ? { companyIds: savedConfig.companyIds ?? [], branchesByCompany: savedConfig.branchesByCompany ?? {} } : emptyConfig);
    setExternalEntries((entries ?? []).map((e: any) => ({ id: e.id, label: e.label, kind: e.kind, amount: Number(e.amount) })));
    setLoading(false);
  }, [appUser]);

  useEffect(() => { if (hasMultipleCompanies) load(); else setLoading(false); }, [hasMultipleCompanies, load]);

  const handleGenerate = async (dateRange: DateRange | undefined) => {
    setGenerating(true);
    try {
      const p_date_from = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null;
      const p_date_to = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : null;
      const { data, error } = await supabase.rpc('get_consolidated_dashboard', { p_date_from, p_date_to });
      if (error) throw error;
      setReport((data ?? []).map(numberRow));
      // La config pudo cambiar en el diálogo justo antes de generar; usamos la
      // más reciente para que el reporte coincida con lo que se acaba de elegir.
      const { data: profileRow } = await supabase.from('profiles').select('consolidated_dashboard_config').eq('id', appUser!.id).maybeSingle();
      const savedConfig = (profileRow as any)?.consolidated_dashboard_config;
      const usedConfig = savedConfig && typeof savedConfig === 'object'
        ? { companyIds: savedConfig.companyIds ?? [], branchesByCompany: savedConfig.branchesByCompany ?? {} }
        : config;
      setConfig(usedConfig);
      setReportConfig(usedConfig);
      setReportRange(dateRange);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo generar el reporte.', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  // Filtra las filas del reporte generado según empresas/sucursales marcadas.
  const filteredRows = useMemo(() => {
    if (!report) return [];
    const result: DashboardRow[] = [];
    for (const companyId of reportConfig.companyIds) {
      const branchFilter = reportConfig.branchesByCompany[companyId];
      const hasBranchFilter = !!branchFilter && branchFilter.length > 0;
      for (const r of report) {
        if (r.company_id !== companyId) continue;
        if (r.branch_id === null) { result.push(r); continue; } // fila de inventario, siempre incluida
        if (hasBranchFilter && !branchFilter!.includes(r.branch_id)) continue;
        result.push(r);
      }
    }
    return result;
  }, [report, reportConfig]);

  const stats = useMemo(() => {
    let revenue = 0, subtotalRevenue = 0, cogs = 0, salesCount = 0, expenses = 0, receivables = 0,
        inventoryCostValue = 0, inventoryUnits = 0, loansBalance = 0, loansActiveCount = 0;
    for (const r of filteredRows) {
      if (r.branch_id === null) { inventoryCostValue += r.inventory_cost_value; inventoryUnits += r.inventory_units; continue; }
      revenue += r.revenue; subtotalRevenue += r.subtotal_revenue; cogs += r.cogs; salesCount += r.sales_count;
      expenses += r.expenses; receivables += r.receivables_pending; loansBalance += r.loans_balance; loansActiveCount += r.loans_active_count;
    }
    const externalIncome = externalEntries.filter((e) => e.kind === 'income').reduce((a, e) => a + e.amount, 0);
    const externalExpense = externalEntries.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
    const netProfit = (subtotalRevenue - cogs) - expenses + externalIncome - externalExpense;
    return { revenue, salesCount, expenses, receivables, inventoryCostValue, inventoryUnits, loansBalance, loansActiveCount, netProfit, externalIncome, externalExpense };
  }, [filteredRows, externalEntries]);

  // Desglose por empresa, más una fila POR CADA entrada manual (con su
  // propia etiqueta, no agrupadas en un genérico "Otros").
  const breakdown = useMemo(() => {
    return reportConfig.companyIds.map((companyId) => {
      const company = availableCompanies.find((c) => c.id === companyId);
      let revenue = 0, expenses = 0, subtotalRevenue = 0, cogs = 0, inventoryCostValue = 0;
      for (const r of filteredRows) {
        if (r.company_id !== companyId) continue;
        if (r.branch_id === null) { inventoryCostValue += r.inventory_cost_value; continue; }
        revenue += r.revenue; expenses += r.expenses; subtotalRevenue += r.subtotal_revenue; cogs += r.cogs;
      }
      return { id: companyId, name: company?.name ?? 'Empresa', revenue, expenses, netProfit: (subtotalRevenue - cogs) - expenses, inventoryCostValue };
    });
  }, [reportConfig, filteredRows, availableCompanies]);

  const salesByBranch = useMemo(() => filteredRows.filter((r) => r.branch_id !== null), [filteredRows]);
  const inventoryByCompany = useMemo(() => filteredRows.filter((r) => r.branch_id === null), [filteredRows]);

  if (!hasMultipleCompanies) {
    return (
      <div>
        <PageHeader title="Panel Consolidado" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No tienes permiso para ver esta sección.
        </CardContent></Card>
      </div>
    );
  }

  const rangeLabel = reportRange?.from
    ? `${format(reportRange.from, 'dd/MM/yyyy', { locale: es })}${reportRange.to ? ` - ${format(reportRange.to, 'dd/MM/yyyy', { locale: es })}` : ''}`
    : 'Todo el historial';

  return (
    <div className="space-y-6">
      <PageHeader title="Panel Consolidado">
        <Button variant="outline" onClick={() => setConfigOpen(true)} className="print:hidden" disabled={loading || generating}>
          <FileBarChart className="mr-2 h-4 w-4" />
          {generating ? 'Generando...' : 'Generar Reporte'}
        </Button>
      </PageHeader>

      {!loading && report === null && (
        <Card><CardContent className="py-14 text-center text-muted-foreground space-y-3">
          <p>Elige tus empresas, sucursales y un rango de fechas, y presiona &quot;Generar Reporte&quot; para ver tu consolidado.</p>
          <Button onClick={() => setConfigOpen(true)}>
            <FileBarChart className="mr-2 h-4 w-4" />
            Generar Reporte
          </Button>
        </CardContent></Card>
      )}

      {report !== null && (
        <>
          <p className="text-sm text-muted-foreground">Período: <span className="font-medium text-foreground">{rangeLabel}</span></p>

          <Tabs defaultValue="resumen">
            <TabsList className="print:hidden">
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="ventas">Ventas por Sucursal</TabsTrigger>
              <TabsTrigger value="cobrar">Cuentas por Cobrar</TabsTrigger>
              <TabsTrigger value="inventario">Inventario</TabsTrigger>
            </TabsList>

            <TabsContent value="resumen" className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Ingresos Totales</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold">{formatCurrency(stats.revenue)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">{stats.salesCount} transacciones</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Egresos Totales</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold text-orange-500">{formatCurrency(stats.expenses)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">Gastos de operación</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-emerald-500/5 to-transparent">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Ganancia Neta</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold text-emerald-600">{formatCurrency(stats.netProfit)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">
                      {externalEntries.length > 0 ? 'Incluye entradas manuales' : 'Empresas seleccionadas'}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Cuentas por Cobrar</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold text-blue-500">{formatCurrency(stats.receivables)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">Saldo actual, no afectado por el rango</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Valor de Inventario</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold">{formatCurrency(stats.inventoryCostValue)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">{stats.inventoryUnits} unidades — saldo actual</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-indigo-500/5 to-transparent">
                  <CardHeader className="pb-1">
                    <CardDescription className="text-2xs uppercase font-bold tracking-wider">Saldo de Préstamos</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-bold text-indigo-500">{formatCurrency(stats.loansBalance)}</div>
                    <p className="text-3xs text-muted-foreground mt-1">{stats.loansActiveCount} préstamos activos — saldo actual</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold">Desglose por empresa</CardTitle>
                  <div className="flex gap-2 print:hidden">
                    <ExportButton
                      filename="consolidado_desglose"
                      rows={[...breakdown.map((b) => ({ name: b.name, revenue: b.revenue, expenses: b.expenses, netProfit: b.netProfit, inventoryCostValue: b.inventoryCostValue })),
                             ...externalEntries.map((e) => ({ name: e.label, revenue: e.kind === 'income' ? e.amount : 0, expenses: e.kind === 'expense' ? e.amount : 0, netProfit: e.kind === 'income' ? e.amount : -e.amount, inventoryCostValue: 0 }))]}
                      columns={[
                        { header: 'Empresa', value: (r) => r.name },
                        { header: 'Ingresos', value: (r) => r.revenue },
                        { header: 'Gastos', value: (r) => r.expenses },
                        { header: 'Ganancia', value: (r) => r.netProfit },
                        { header: 'Inventario', value: (r) => r.inventoryCostValue },
                      ]}
                    />
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" /> Imprimir
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead className="text-right">Ingresos</TableHead>
                          <TableHead className="text-right">Gastos</TableHead>
                          <TableHead className="text-right">Ganancia</TableHead>
                          <TableHead className="text-right">Inventario</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {breakdown.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell className="font-medium">{b.name}</TableCell>
                            <TableCell className="text-right">{formatCurrency(b.revenue)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(b.expenses)}</TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(b.netProfit)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(b.inventoryCostValue)}</TableCell>
                          </TableRow>
                        ))}
                        {externalEntries.map((e) => (
                          <TableRow key={e.id} className="bg-muted/30">
                            <TableCell className="font-medium">{e.label}</TableCell>
                            <TableCell className="text-right">{e.kind === 'income' ? formatCurrency(e.amount) : '—'}</TableCell>
                            <TableCell className="text-right">{e.kind === 'expense' ? formatCurrency(e.amount) : '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(e.kind === 'income' ? e.amount : -e.amount)}</TableCell>
                            <TableCell className="text-right">—</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{formatCurrency(stats.revenue + stats.externalIncome)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(stats.expenses + stats.externalExpense)}</TableCell>
                          <TableCell className="text-right text-emerald-600">{formatCurrency(stats.netProfit)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(stats.inventoryCostValue)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ventas">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold">Ventas por Sucursal</CardTitle>
                  <div className="flex gap-2 print:hidden">
                    <ExportButton
                      filename="consolidado_ventas_sucursal"
                      rows={salesByBranch}
                      columns={[
                        { header: 'Empresa', value: (r) => r.company_name },
                        { header: 'Sucursal', value: (r) => r.branch_name ?? '' },
                        { header: 'Ventas', value: (r) => r.sales_count },
                        { header: 'Ingresos', value: (r) => r.revenue },
                        { header: 'Costo', value: (r) => r.cogs },
                        { header: 'Margen Bruto', value: (r) => r.subtotal_revenue - r.cogs },
                      ]}
                    />
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" /> Imprimir
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead>Sucursal</TableHead>
                          <TableHead className="text-right">Ventas</TableHead>
                          <TableHead className="text-right">Ingresos</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                          <TableHead className="text-right">Margen Bruto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesByBranch.length > 0 ? salesByBranch.map((r) => (
                          <TableRow key={`${r.company_id}-${r.branch_id}`}>
                            <TableCell className="font-medium">{r.company_name}</TableCell>
                            <TableCell>{r.branch_name}</TableCell>
                            <TableCell className="text-right">{r.sales_count}</TableCell>
                            <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(r.cogs)}</TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(r.subtotal_revenue - r.cogs)}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Sin ventas en el período.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cobrar">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold">Cuentas por Cobrar (saldo actual)</CardTitle>
                  <div className="flex gap-2 print:hidden">
                    <ExportButton
                      filename="consolidado_cuentas_por_cobrar"
                      rows={salesByBranch.filter((r) => r.receivables_pending > 0)}
                      columns={[
                        { header: 'Empresa', value: (r) => r.company_name },
                        { header: 'Sucursal', value: (r) => r.branch_name ?? '' },
                        { header: 'Pendiente por Cobrar', value: (r) => r.receivables_pending },
                      ]}
                    />
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" /> Imprimir
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead>Sucursal</TableHead>
                          <TableHead className="text-right">Pendiente por Cobrar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesByBranch.filter((r) => r.receivables_pending > 0).length > 0 ? salesByBranch.filter((r) => r.receivables_pending > 0).map((r) => (
                          <TableRow key={`${r.company_id}-${r.branch_id}`}>
                            <TableCell className="font-medium">{r.company_name}</TableCell>
                            <TableCell>{r.branch_name}</TableCell>
                            <TableCell className="text-right font-semibold text-blue-600">{formatCurrency(r.receivables_pending)}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Sin cuentas por cobrar pendientes.</TableCell></TableRow>
                        )}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={2}>Total</TableCell>
                          <TableCell className="text-right text-blue-600">{formatCurrency(stats.receivables)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="inventario">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-semibold">Inventario (saldo actual)</CardTitle>
                  <div className="flex gap-2 print:hidden">
                    <ExportButton
                      filename="consolidado_inventario"
                      rows={inventoryByCompany}
                      columns={[
                        { header: 'Empresa', value: (r) => r.company_name },
                        { header: 'Valor a Costo', value: (r) => r.inventory_cost_value },
                        { header: 'Unidades', value: (r) => r.inventory_units },
                      ]}
                    />
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="mr-2 h-4 w-4" /> Imprimir
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empresa</TableHead>
                          <TableHead className="text-right">Valor a Costo</TableHead>
                          <TableHead className="text-right">Unidades</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inventoryByCompany.length > 0 ? inventoryByCompany.map((r) => (
                          <TableRow key={r.company_id}>
                            <TableCell className="font-medium">{r.company_name}</TableCell>
                            <TableCell className="text-right">{formatCurrency(r.inventory_cost_value)}</TableCell>
                            <TableCell className="text-right">{r.inventory_units}</TableCell>
                          </TableRow>
                        )) : (
                          <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Sin inventario.</TableCell></TableRow>
                        )}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right">{formatCurrency(stats.inventoryCostValue)}</TableCell>
                          <TableCell className="text-right">{stats.inventoryUnits}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {appUser && (
        <ConsolidatedDashboardConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          profileId={appUser.id}
          availableCompanies={availableCompanies}
          config={config}
          onConfigSaved={setConfig}
          externalEntries={externalEntries}
          onExternalEntriesChanged={setExternalEntries}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
}
