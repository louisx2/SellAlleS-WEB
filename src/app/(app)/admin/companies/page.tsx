'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Building2 } from 'lucide-react';
import { DashboardStats } from '@/components/admin/dashboard-stats';
import { PlatformSalesChart, CompaniesGrowthChart } from '@/components/admin/platform-charts';
import {
  TopCompaniesCard, PlanDistributionCard, AttentionCard,
  type TopCompany, type PlanSlice, type AttentionItem,
} from '@/components/admin/platform-insights';
import type { Company } from '@/lib/types';

interface Plan { id: string; name: string; price: number; monthly_price?: number | null; }
interface Sub { id: string; company_id: string; plan_id: string | null; custom_monthly_price?: number | null; }
interface PlatformSale { company_id: string | null; total: number; created_at: string; }

export default function PlatformDashboardPage() {
  const { appUser } = useAuth();
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [profiles, setProfiles] = useState<{ id: string; created_at: string; company_id: string | null }[]>([]);
  const [platformSales, setPlatformSales] = useState<PlatformSale[]>([]);
  const [dashboardMode, setDashboardMode] = useState<'real' | 'demo' | 'all'>('real');

  const load = useCallback(async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [
      { data: comps },
      { data: pls },
      { data: ss },
      { data: profs },
      { data: sls },
    ] = await Promise.all([
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('plans').select('id, name, price, monthly_price').order('price'),
      supabase.from('subscriptions').select('id, company_id, plan_id, custom_monthly_price'),
      supabase.from('profiles').select('id, created_at, company_id'),
      // RLS: el super admin ve las ventas de todos los tenants.
      supabase.from('sales').select('company_id, total, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
    ]);

    if (comps) setCompanies(comps as Company[]);
    if (pls) setPlans(pls as Plan[]);
    if (ss) {
      const map: Record<string, Sub> = {};
      (ss as Sub[]).forEach((s) => { map[s.company_id] = s; });
      setSubs(map);
    }
    if (profs) {
      setProfiles(profs as any[]);
    }
    if (sls) setPlatformSales((sls as any[]).map((s) => ({ ...s, total: Number(s.total) })));
  }, []);

  useEffect(() => { if (appUser?.isSuperAdmin) load(); }, [appUser, load]);

  if (!appUser?.isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Plataforma" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No tienes permiso para ver esta sección.
        </CardContent></Card>
      </div>
    );
  }

  // ---------- Filtros por tipo de empresa (Real / Demo) ----------
  const filteredComps = companies.filter(c => {
    if (dashboardMode === 'real') return !c.is_demo;
    if (dashboardMode === 'demo') return !!c.is_demo;
    return true; // 'all'
  });

  const filteredSales = platformSales.filter(s => {
    if (!s.company_id) return false;
    const comp = companies.find(c => c.id === s.company_id);
    if (!comp) return false;
    if (dashboardMode === 'real') return !comp.is_demo;
    if (dashboardMode === 'demo') return !!comp.is_demo;
    return true;
  });

  const activeProfiles = profiles.filter(p => {
    if (!p.company_id) return true; // usuarios sin empresa
    const comp = companies.find(c => c.id === p.company_id);
    if (!comp) return false;
    if (dashboardMode === 'real') return !comp.is_demo;
    if (dashboardMode === 'demo') return !!comp.is_demo;
    return true;
  });

  const displayTotalUsers = activeProfiles.length;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const displayNewUsersWeek = activeProfiles.filter(p => p.created_at && new Date(p.created_at) > weekAgo).length;

  // ---------- Métricas de la plataforma ----------
  const activeCompanies = filteredComps.filter(c => c.status === 'active').length;
  const trialCompanies = filteredComps.filter(c => c.status === 'trial').length;
  const suspendedCompanies = filteredComps.filter(c => c.status === 'suspended').length;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newCompaniesWeek = filteredComps.filter((c) => c.created_at && new Date(c.created_at) > oneWeekAgo).length;

  let projectedMRR = 0;
  let payingCompanies = 0;
  filteredComps.forEach(c => {
    if (c.status === 'active') {
      const sub = subs[c.id];
      const plan = plans.find(p => p.id === sub?.plan_id);
      const planPrice = plan?.monthly_price ?? sub?.custom_monthly_price ?? 0;
      if (planPrice > 0) payingCompanies += 1;
      projectedMRR += planPrice;
    }
  });

  const platformSales30d = filteredSales.reduce((acc, s) => acc + s.total, 0);
  const platformTx30d = filteredSales.length;

  // Ventas por día (últimos 14 días).
  const salesByDay: { name: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const total = filteredSales
      .filter((s) => { const d = new Date(s.created_at); return d >= day && d < next; })
      .reduce((acc, s) => acc + s.total, 0);
    salesByDay.push({ name: day.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }), total });
  }

  // Altas de empresas por mes (últimos 6 meses).
  const companiesByMonth: { name: string; nuevas: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const month = new Date();
    month.setDate(1);
    month.setMonth(month.getMonth() - i);
    const label = month.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' });
    const nuevas = filteredComps.filter((c) => {
      if (!c.created_at) return false;
      const d = new Date(c.created_at);
      return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
    }).length;
    companiesByMonth.push({ name: label, nuevas });
  }

  // Top empresas por ventas (30 días).
  const salesByCompany = new Map<string, { total: number; txCount: number }>();
  filteredSales.forEach((s) => {
    if (!s.company_id) return;
    const agg = salesByCompany.get(s.company_id) ?? { total: 0, txCount: 0 };
    agg.total += s.total;
    agg.txCount += 1;
    salesByCompany.set(s.company_id, agg);
  });
  const topCompanies: TopCompany[] = [...salesByCompany.entries()]
    .map(([companyId, agg]) => ({ company: filteredComps.find((c) => c.id === companyId), ...agg }))
    .filter((t): t is TopCompany => t.company !== undefined)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Distribución por plan.
  const planSlices: PlanSlice[] = plans.map((p) => ({
    name: p.name,
    price: p.monthly_price ?? 0,
    count: filteredComps.filter((c) => subs[c.id]?.plan_id === p.id).length,
  }));
  const withoutPlan = filteredComps.filter((c) => !subs[c.id]?.plan_id).length;
  if (withoutPlan > 0) planSlices.push({ name: 'Sin plan', price: 0, count: withoutPlan });

  // Empresas que requieren seguimiento.
  const attentionItems: AttentionItem[] = [];
  filteredComps.forEach((c) => {
    if (c.status === 'suspended') {
      attentionItems.push({ company: c, reason: 'Suspendida', severity: 'destructive' });
    } else if (c.status === 'trial' && c.created_at) {
      const days = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000);
      if (days > 14) attentionItems.push({ company: c, reason: `En prueba hace ${days} días`, severity: 'warn' });
    } else if (c.status === 'active' && !subs[c.id]?.plan_id) {
      attentionItems.push({ company: c, reason: 'Activa sin plan', severity: 'warn' });
    }
  });
  attentionItems.sort((a) => (a.severity === 'destructive' ? -1 : 1));

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plataforma</h1>
          <p className="text-muted-foreground mt-1">Visión general del SaaS y todas sus instancias.</p>
        </div>
        <Button onClick={() => router.push('/admin/empresas')} className="w-full sm:w-auto shadow-sm">
          <Building2 className="mr-2 h-4 w-4" />
          Gestionar empresas
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
        <div className="flex bg-muted p-1 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setDashboardMode('real')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              dashboardMode === 'real'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Datos Reales
          </button>
          <button
            onClick={() => setDashboardMode('demo')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              dashboardMode === 'demo'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Empresas Demo
          </button>
          <button
            onClick={() => setDashboardMode('all')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              dashboardMode === 'all'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Todos
          </button>
        </div>
        
        {dashboardMode === 'demo' && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg font-semibold uppercase tracking-wide">
            Filtro Activo: Métricas Demo
          </div>
        )}
      </div>

      <DashboardStats
        totalCompanies={filteredComps.length}
        activeCompanies={activeCompanies}
        trialCompanies={trialCompanies}
        suspendedCompanies={suspendedCompanies}
        newCompaniesWeek={newCompaniesWeek}
        totalUsers={displayTotalUsers}
        newUsersWeek={displayNewUsersWeek}
        projectedMRR={projectedMRR}
        payingCompanies={payingCompanies}
        platformSales30d={platformSales30d}
        platformTx30d={platformTx30d}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformSalesChart data={salesByDay} />
        <CompaniesGrowthChart data={companiesByMonth} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopCompaniesCard items={topCompanies} />
        <PlanDistributionCard slices={planSlices} totalCompanies={filteredComps.length} />
        <AttentionCard items={attentionItems} onEdit={() => router.push('/admin/empresas')} />
      </div>
    </div>
  );
}
