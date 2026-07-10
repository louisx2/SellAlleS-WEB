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

interface Plan { id: string; name: string; price: number; }
interface Sub { id: string; company_id: string; plan_id: string | null; }
interface PlatformSale { company_id: string | null; total: number; created_at: string; }

export default function PlatformDashboardPage() {
  const { appUser } = useAuth();
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [totalUsers, setTotalUsers] = useState(0);
  const [newUsersWeek, setNewUsersWeek] = useState(0);
  const [platformSales, setPlatformSales] = useState<PlatformSale[]>([]);

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
      supabase.from('plans').select('id, name, price').order('price'),
      supabase.from('subscriptions').select('id, company_id, plan_id'),
      supabase.from('profiles').select('id, created_at'),
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
      setTotalUsers(profs.length);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      setNewUsersWeek(profs.filter((p: any) => p.created_at && new Date(p.created_at) > weekAgo).length);
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

  // ---------- Métricas de la plataforma ----------
  const activeCompanies = companies.filter(c => c.status === 'active').length;
  const trialCompanies = companies.filter(c => c.status === 'trial').length;
  const suspendedCompanies = companies.filter(c => c.status === 'suspended').length;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newCompaniesWeek = companies.filter((c) => c.created_at && new Date(c.created_at) > oneWeekAgo).length;

  let projectedMRR = 0;
  let payingCompanies = 0;
  companies.forEach(c => {
    if (c.status === 'active') {
      const planId = subs[c.id]?.plan_id;
      const planPrice = plans.find(p => p.id === planId)?.price || 0;
      if (planPrice > 0) payingCompanies += 1;
      projectedMRR += planPrice;
    }
  });

  const platformSales30d = platformSales.reduce((acc, s) => acc + s.total, 0);
  const platformTx30d = platformSales.length;

  // Ventas por día (últimos 14 días, todos los tenants).
  const salesByDay: { name: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const total = platformSales
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
    const nuevas = companies.filter((c) => {
      if (!c.created_at) return false;
      const d = new Date(c.created_at);
      return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
    }).length;
    companiesByMonth.push({ name: label, nuevas });
  }

  // Top empresas por ventas (30 días).
  const salesByCompany = new Map<string, { total: number; txCount: number }>();
  platformSales.forEach((s) => {
    if (!s.company_id) return;
    const agg = salesByCompany.get(s.company_id) ?? { total: 0, txCount: 0 };
    agg.total += s.total;
    agg.txCount += 1;
    salesByCompany.set(s.company_id, agg);
  });
  const topCompanies: TopCompany[] = [...salesByCompany.entries()]
    .map(([companyId, agg]) => ({ company: companies.find((c) => c.id === companyId), ...agg }))
    .filter((t): t is TopCompany => t.company !== undefined)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Distribución por plan.
  const planSlices: PlanSlice[] = plans.map((p) => ({
    name: p.name,
    price: p.price,
    count: companies.filter((c) => subs[c.id]?.plan_id === p.id).length,
  }));
  const withoutPlan = companies.filter((c) => !subs[c.id]?.plan_id).length;
  if (withoutPlan > 0) planSlices.push({ name: 'Sin plan', price: 0, count: withoutPlan });

  // Empresas que requieren seguimiento.
  const attentionItems: AttentionItem[] = [];
  companies.forEach((c) => {
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

      <DashboardStats
        totalCompanies={companies.length}
        activeCompanies={activeCompanies}
        trialCompanies={trialCompanies}
        suspendedCompanies={suspendedCompanies}
        newCompaniesWeek={newCompaniesWeek}
        totalUsers={totalUsers}
        newUsersWeek={newUsersWeek}
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
        <PlanDistributionCard slices={planSlices} totalCompanies={companies.length} />
        <AttentionCard items={attentionItems} onEdit={() => router.push('/admin/empresas')} />
      </div>
    </div>
  );
}
