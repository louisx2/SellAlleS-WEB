'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { LoanDataTable } from '@/components/loans/loan-data-table';
import { buildLoanColumns } from '@/components/loans/loan-columns';
import { LoanDialog } from '@/components/loans/loan-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle, HandCoins, Wallet, TrendingUp } from 'lucide-react';

export default function PrestamosPage() {
  const { loans } = useLoans();
  const { profile } = useCompanyProfile();
  const columns = useMemo(() => buildLoanColumns(profile.loanLateFeeRate), [profile.loanLateFeeRate]);

  // Resumen del negocio de prestamista: cuánto está en la calle, cuánto falta
  // por cobrar y cuánto es ganancia (interés) del total prestado.
  const stats = useMemo(() => {
    const active = loans.filter((l) => l.status === 'active');
    const prestado = active.reduce((acc, l) => acc + l.principal, 0);
    const porCobrar = active.reduce((acc, l) => acc + Math.max(l.totalWithInterest - l.amountPaid, 0), 0);
    const ganancia = loans.reduce((acc, l) => acc + (l.totalWithInterest - l.principal), 0);
    return { prestado, porCobrar, ganancia, activos: active.length };
  }, [loans]);

  return (
    <div>
      <PageHeader title="Préstamos">
        <LoanDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Nuevo préstamo
          </Button>
        </LoanDialog>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dinero en la calle</CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.prestado)}</div>
            <p className="text-xs text-muted-foreground">{stats.activos} {stats.activos === 1 ? 'préstamo activo' : 'préstamos activos'}</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Por cobrar</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.porCobrar)}</div>
            <p className="text-xs text-muted-foreground">capital + interés pendiente</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ganancia (interés)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(stats.ganancia)}</div>
            <p className="text-xs text-muted-foreground">interés total de todos los préstamos</p>
          </CardContent>
        </Card>
      </div>

      <LoanDataTable columns={columns} data={loans} />
    </div>
  );
}
