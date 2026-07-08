'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Building2, Users, TrendingUp, ShoppingCart } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface DashboardStatsProps {
  totalCompanies: number;
  activeCompanies: number;
  trialCompanies: number;
  suspendedCompanies: number;
  newCompaniesWeek: number;
  totalUsers: number;
  newUsersWeek: number;
  projectedMRR: number;
  payingCompanies: number;
  platformSales30d: number;
  platformTx30d: number;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: React.ReactNode;
  accent: string;
}) {
  return (
    <Card className="shadow-sm transition-all hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <h3 className="mt-2 text-3xl font-bold tracking-tight">{value}</h3>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function DashboardStats({
  totalCompanies,
  activeCompanies,
  trialCompanies,
  suspendedCompanies,
  newCompaniesWeek,
  totalUsers,
  newUsersWeek,
  projectedMRR,
  payingCompanies,
  platformSales30d,
  platformTx30d,
}: DashboardStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={Building2}
        label="Empresas"
        value={String(totalCompanies)}
        accent="bg-primary/15 text-primary"
        detail={
          <span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{activeCompanies} activas</span>
            {' · '}{trialCompanies} en prueba
            {suspendedCompanies > 0 && (
              <>
                {' · '}
                <span className="text-destructive font-medium">{suspendedCompanies} suspendidas</span>
              </>
            )}
            {newCompaniesWeek > 0 && <> · +{newCompaniesWeek} esta semana</>}
          </span>
        }
      />
      <KpiCard
        icon={TrendingUp}
        label="Ingresos del SaaS (MRR)"
        value={formatCurrency(projectedMRR)}
        accent="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        detail={`${payingCompanies} ${payingCompanies === 1 ? 'empresa activa con plan' : 'empresas activas con plan'}`}
      />
      <KpiCard
        icon={ShoppingCart}
        label="Ventas de la plataforma (30 días)"
        value={formatCurrency(platformSales30d)}
        accent="bg-blue-500/15 text-blue-600 dark:text-blue-400"
        detail={`${platformTx30d} ${platformTx30d === 1 ? 'transacción' : 'transacciones'} en todos los tenants`}
      />
      <KpiCard
        icon={Users}
        label="Usuarios"
        value={String(totalUsers)}
        accent="bg-violet-500/15 text-violet-600 dark:text-violet-400"
        detail={newUsersWeek > 0 ? `+${newUsersWeek} esta semana` : 'Perfiles en toda la plataforma'}
      />
    </div>
  );
}
