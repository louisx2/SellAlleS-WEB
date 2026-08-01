'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { LoanDataTable } from '@/components/loans/loan-data-table';
import { buildLoanColumns } from '@/components/loans/loan-columns';
import { LoanDialog } from '@/components/loans/loan-dialog';
import { LoanFundDialog } from '@/components/loans/loan-fund-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle, HandCoins, Wallet, TrendingUp, PiggyBank, ArrowDownCircle, ArrowUpCircle, ClipboardList } from 'lucide-react';

export default function PrestamosPage() {
  const { loans, fund, fundMovements } = useLoans();
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
        <div className="flex flex-wrap gap-2 justify-end">
          <Button asChild variant="outline">
            <Link href="/prestamos/cobros">
              <ClipboardList className="mr-2 h-4 w-4" />
              Cobros del día
            </Link>
          </Button>
          <LoanDialog>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Nuevo préstamo
            </Button>
          </LoanDialog>
        </div>
      </PageHeader>

      <div className={`grid gap-4 mb-6 ${fund ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {/* Solo si la empresa lleva el fondo (loan_fund_enabled). Apagado, la
            pantalla queda como estaba. */}
        {fund && (
          <Card className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Disponible para prestar</CardTitle>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${fund.disponible < 0 ? 'text-destructive' : ''}`}>
                {formatCurrency(fund.disponible)}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(fund.aportes - fund.retiros)} de capital · {formatCurrency(fund.cobrado)} cobrado
              </p>
              <div className="flex gap-2 mt-3">
                <LoanFundDialog type="aporte">
                  <Button variant="outline" size="sm" className="flex-1">
                    <ArrowDownCircle className="mr-1.5 h-3.5 w-3.5" />
                    Aporte
                  </Button>
                </LoanFundDialog>
                <LoanFundDialog type="retiro">
                  <Button variant="outline" size="sm" className="flex-1">
                    <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />
                    Retiro
                  </Button>
                </LoanFundDialog>
              </div>
            </CardContent>
          </Card>
        )}
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

      {fund && fundMovements.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Movimientos de capital</CardTitle>
            <CardDescription>
              El dinero que metes y sacas del negocio. Lo prestado y lo cobrado no se registra aquí:
              ya está en los préstamos y sus abonos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Usuario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundMovements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.createdAt.toLocaleDateString('es-DO')}</TableCell>
                    <TableCell>{m.type === 'aporte' ? 'Aporte' : 'Retiro'}</TableCell>
                    <TableCell className={`text-right font-medium ${m.type === 'aporte' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                      {m.type === 'aporte' ? '+' : '−'} {formatCurrency(m.amount)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate" title={m.reason}>{m.reason ?? '—'}</TableCell>
                    <TableCell>{m.userName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
