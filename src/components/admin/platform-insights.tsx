'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatCurrency } from '@/lib/utils';
import { Trophy, PieChart, AlertTriangle, Pencil } from 'lucide-react';
import type { Company } from '@/lib/types';

export interface TopCompany {
  company: Company;
  total: number;
  txCount: number;
}

export interface PlanSlice {
  name: string;
  count: number;
  price: number;
}

export interface AttentionItem {
  company: Company;
  reason: string;
  severity: 'warn' | 'destructive';
}

export function TopCompaniesCard({ items }: { items: TopCompany[] }) {
  const max = items[0]?.total ?? 0;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-amber-500" />
          Top Empresas por Ventas
        </CardTitle>
        <CardDescription>Últimos 30 días.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sin ventas en los últimos 30 días.</p>
        ) : (
          items.map(({ company, total, txCount }, i) => (
            <div key={company.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate mr-2">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                  {company.name}
                </span>
                <span className="font-semibold whitespace-nowrap">{formatCurrency(total)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={max > 0 ? (total / max) * 100 : 0} className="h-1.5" />
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{txCount} ventas</span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function PlanDistributionCard({ slices, totalCompanies }: { slices: PlanSlice[]; totalCompanies: number }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="h-4 w-4 text-blue-500" />
          Distribución por Plan
        </CardTitle>
        <CardDescription>Empresas suscritas a cada plan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {slices.map((s) => (
          <div key={s.name} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">
                {s.count} {s.count === 1 ? 'empresa' : 'empresas'}
                {s.price > 0 && <span className="ml-1 text-[11px]">({formatCurrency(s.price)}/mes)</span>}
              </span>
            </div>
            <Progress value={totalCompanies > 0 ? (s.count / totalCompanies) * 100 : 0} className="h-1.5" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AttentionCard({ items, onEdit }: { items: AttentionItem[]; onEdit: (c: Company) => void }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Requiere Atención
        </CardTitle>
        <CardDescription>Empresas con seguimiento pendiente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Todo en orden. 🎉</p>
        ) : (
          items.map(({ company, reason, severity }) => (
            <div
              key={`${company.id}-${reason}`}
              className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{company.name}</p>
                <Badge
                  variant={severity === 'destructive' ? 'destructive' : 'secondary'}
                  className="mt-1 text-[10px]"
                >
                  {reason}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Gestionar" onClick={() => onEdit(company)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
