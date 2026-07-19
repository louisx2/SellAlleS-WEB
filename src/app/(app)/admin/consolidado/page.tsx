'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import { Settings, TrendingUp, DollarSign, ArrowDownRight, Wallet, Package, HandCoins } from 'lucide-react';
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

export default function ConsolidatedDashboardPage() {
  const { appUser } = useAuth();
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [config, setConfig] = useState<ConsolidatedDashboardConfig>(emptyConfig);
  const [externalEntries, setExternalEntries] = useState<ExternalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);

  const hasMultipleCompanies = !!(appUser?.companies && appUser.companies.length > 1);

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    const [{ data: dashboardRows }, { data: profileRow }, { data: entries }] = await Promise.all([
      supabase.rpc('get_consolidated_dashboard'),
      supabase.from('profiles').select('consolidated_dashboard_config').eq('id', appUser.id).maybeSingle(),
      supabase.from('dashboard_external_entries').select('*').eq('profile_id', appUser.id).order('created_at'),
    ]);
    setRows((dashboardRows ?? []).map((r: any) => ({
      ...r,
      revenue: Number(r.revenue), subtotal_revenue: Number(r.subtotal_revenue), cogs: Number(r.cogs),
      sales_count: Number(r.sales_count), expenses: Number(r.expenses), receivables_pending: Number(r.receivables_pending),
      inventory_cost_value: Number(r.inventory_cost_value), inventory_units: Number(r.inventory_units),
      loans_balance: Number(r.loans_balance), loans_active_count: Number(r.loans_active_count),
    })));
    const savedConfig = (profileRow as any)?.consolidated_dashboard_config;
    setConfig(savedConfig && typeof savedConfig === 'object' ? { companyIds: savedConfig.companyIds ?? [], branchesByCompany: savedConfig.branchesByCompany ?? {} } : emptyConfig);
    setExternalEntries((entries ?? []).map((e: any) => ({ id: e.id, label: e.label, kind: e.kind, amount: Number(e.amount) })));
    setLoading(false);
  }, [appUser]);

  useEffect(() => { if (hasMultipleCompanies) load(); else setLoading(false); }, [hasMultipleCompanies, load]);

  // Empresas disponibles para el diálogo de configuración: se derivan de las
  // propias filas del RPC (ya viene limitado a las empresas donde el usuario
  // es admin), sin consulta adicional.
  const availableCompanies: AvailableCompany[] = useMemo(() => {
    const byCompany = new Map<string, AvailableCompany>();
    rows.forEach((r) => {
      if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, { id: r.company_id, name: r.company_name, branches: [] });
      if (r.branch_id && r.branch_name) {
        const entry = byCompany.get(r.company_id)!;
        if (!entry.branches.some((b) => b.id === r.branch_id)) entry.branches.push({ id: r.branch_id, name: r.branch_name });
      }
    });
    return Array.from(byCompany.values());
  }, [rows]);

  const stats = useMemo(() => {
    let revenue = 0, subtotalRevenue = 0, cogs = 0, salesCount = 0, expenses = 0, receivables = 0,
        inventoryCostValue = 0, inventoryUnits = 0, loansBalance = 0, loansActiveCount = 0;

    for (const companyId of config.companyIds) {
      const branchFilter = config.branchesByCompany[companyId];
      const hasBranchFilter = !!branchFilter && branchFilter.length > 0;
      for (const r of rows) {
        if (r.company_id !== companyId) continue;
        if (r.branch_id === null) {
          // Fila de inventario: siempre suma una vez por empresa incluida.
          inventoryCostValue += r.inventory_cost_value;
          inventoryUnits += r.inventory_units;
          continue;
        }
        if (hasBranchFilter && !branchFilter!.includes(r.branch_id)) continue;
        revenue += r.revenue;
        subtotalRevenue += r.subtotal_revenue;
        cogs += r.cogs;
        salesCount += r.sales_count;
        expenses += r.expenses;
        receivables += r.receivables_pending;
        loansBalance += r.loans_balance;
        loansActiveCount += r.loans_active_count;
      }
    }

    const externalIncome = externalEntries.filter((e) => e.kind === 'income').reduce((a, e) => a + e.amount, 0);
    const externalExpense = externalEntries.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
    const grossProfit = subtotalRevenue - cogs;
    const netProfit = grossProfit - expenses + externalIncome - externalExpense;

    return {
      revenue, salesCount, expenses, receivables, inventoryCostValue, inventoryUnits,
      loansBalance, loansActiveCount, netProfit, externalIncome, externalExpense,
    };
  }, [rows, config, externalEntries]);

  // Desglose por empresa incluida (mismos totales que arriba, por fila).
  const breakdown = useMemo(() => {
    return config.companyIds.map((companyId) => {
      const company = availableCompanies.find((c) => c.id === companyId);
      const branchFilter = config.branchesByCompany[companyId];
      const hasBranchFilter = !!branchFilter && branchFilter.length > 0;
      let revenue = 0, expenses = 0, netProfit = 0, subtotalRevenue = 0, cogs = 0, inventoryCostValue = 0;
      for (const r of rows) {
        if (r.company_id !== companyId) continue;
        if (r.branch_id === null) { inventoryCostValue += r.inventory_cost_value; continue; }
        if (hasBranchFilter && !branchFilter!.includes(r.branch_id)) continue;
        revenue += r.revenue; expenses += r.expenses; subtotalRevenue += r.subtotal_revenue; cogs += r.cogs;
      }
      netProfit = (subtotalRevenue - cogs) - expenses;
      return { id: companyId, name: company?.name ?? 'Empresa', revenue, expenses, netProfit, inventoryCostValue };
    });
  }, [config, rows, availableCompanies]);

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

  return (
    <div className="space-y-6">
      <PageHeader title="Panel Consolidado">
        <Button variant="outline" onClick={() => setConfigOpen(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Configurar
        </Button>
      </PageHeader>

      {!loading && config.companyIds.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Marca al menos una empresa en &quot;Configurar&quot; para ver tus totales consolidados.
        </CardContent></Card>
      )}

      {config.companyIds.length > 0 && (
        <>
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
                <p className="text-3xs text-muted-foreground mt-1">Ventas a crédito pendientes</p>
              </CardContent>
            </Card>
            <Card className="bg-card/40 backdrop-blur-sm border-muted/50">
              <CardHeader className="pb-1">
                <CardDescription className="text-2xs uppercase font-bold tracking-wider">Valor de Inventario</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">{formatCurrency(stats.inventoryCostValue)}</div>
                <p className="text-3xs text-muted-foreground mt-1">{stats.inventoryUnits} unidades</p>
              </CardContent>
            </Card>
            <Card className="bg-card/40 backdrop-blur-sm border-muted/50 bg-gradient-to-br from-indigo-500/5 to-transparent">
              <CardHeader className="pb-1">
                <CardDescription className="text-2xs uppercase font-bold tracking-wider">Saldo de Préstamos</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-indigo-500">{formatCurrency(stats.loansBalance)}</div>
                <p className="text-3xs text-muted-foreground mt-1">{stats.loansActiveCount} préstamos activos</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base font-semibold">Desglose por empresa</CardTitle></CardHeader>
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
                    {externalEntries.length > 0 && (
                      <TableRow className="bg-muted/30">
                        <TableCell className="font-medium">Otros (manual)</TableCell>
                        <TableCell className="text-right">{formatCurrency(stats.externalIncome)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(stats.externalExpense)}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600">{formatCurrency(stats.externalIncome - stats.externalExpense)}</TableCell>
                        <TableCell className="text-right">—</TableCell>
                      </TableRow>
                    )}
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
        />
      )}
    </div>
  );
}
