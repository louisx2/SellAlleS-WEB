'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToLoanPayment } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import type { LoanPayment, PaymentMethod } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DialogTrigger } from '@/components/ui/dialog';
import { RegisterLoanPaymentDialog } from '@/components/loans/register-loan-payment-dialog';
import { ArrowLeft, DollarSign } from 'lucide-react';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const INSTALLMENT_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  paid: { label: 'Pagada', variant: 'default' },
  partial: { label: 'Parcial', variant: 'secondary' },
  pending: { label: 'Pendiente', variant: 'outline' },
};

export default function LoanDetailClient() {
  const params = useParams();
  const loanId = params.loanId as string;
  const { loans } = useLoans();
  const { profile } = useCompanyProfile();
  const [payments, setPayments] = useState<LoanPayment[]>([]);

  const loan = loans.find((l) => l.id === loanId);

  useEffect(() => {
    if (!loanId) return;
    (async () => {
      const { data } = await supabase
        .from('loan_payments')
        .select('*')
        .eq('loan_id', loanId)
        .order('date', { ascending: false });
      if (data) setPayments(data.map(rowToLoanPayment));
    })();
  }, [loanId, loans]);

  const status = useMemo(
    () => (loan ? calculateLoanStatus(loan, profile.loanLateFeeRate) : null),
    [loan, profile.loanLateFeeRate],
  );

  if (!loan || !status) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-10">
        <h1 className="text-2xl font-bold mb-4">Préstamo no encontrado</h1>
        <p className="text-muted-foreground mb-6">No encontramos el préstamo con ID: {loanId}</p>
        <Button asChild>
          <Link href="/prestamos">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Préstamos
          </Link>
        </Button>
      </div>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/prestamos">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Link>
        </Button>
        {status.pendingBalance > 0 && (
          <RegisterLoanPaymentDialog loan={loan}>
            <DialogTrigger asChild>
              <Button>
                <DollarSign className="mr-2 h-4 w-4" />
                Registrar Abono
              </Button>
            </DialogTrigger>
          </RegisterLoanPaymentDialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {loan.customer?.name ?? 'Cliente'}
            {status.pendingBalance <= 0 ? (
              <Badge className="bg-green-600">Pagado</Badge>
            ) : status.isOverdue ? (
              <Badge variant="destructive">Atrasado</Badge>
            ) : (
              <Badge variant="outline">Al día</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Préstamo del {loan.createdAt.toLocaleDateString('es-DO')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Monto prestado</p>
              <p className="font-semibold">{formatCurrency(loan.principal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Abono inicial</p>
              <p className="font-semibold">{formatCurrency(loan.downPayment)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tasa mensual / Cuotas</p>
              <p className="font-semibold">{loan.interestRate}% · {loan.installmentsCount} cuotas</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total con intereses</p>
              <p className="font-semibold">{formatCurrency(loan.totalWithInterest)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pagado</p>
              <p className="font-semibold text-green-600">{formatCurrency(loan.amountPaid)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Balance pendiente</p>
              <p className="font-semibold text-destructive">{formatCurrency(status.pendingBalance)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Mora exigible</p>
              <p className="font-semibold text-destructive">{formatCurrency(status.lateFee)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Próximo vencimiento</p>
              <p className="font-semibold">{status.nextDueDate ? status.nextDueDate.toLocaleDateString('es-DO') : '—'}</p>
            </div>
          </div>
          {loan.notes && (
            <p className="mt-4 text-sm text-muted-foreground border-t pt-3">Notas: {loan.notes}</p>
          )}
        </CardContent>
      </Card>

      {loan.installments && loan.installments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan de Cuotas</CardTitle>
            <CardDescription>
              La mora ({profile.loanLateFeeRate}% por cuota vencida) se cobra primero al registrar un abono.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Mora cobrada</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.installments.map((cuota) => {
                  const dueDate = new Date(cuota.dueDate + 'T00:00:00');
                  const isOverdue = cuota.status !== 'paid' && new Date(cuota.dueDate + 'T23:59:59') < today;
                  const feeDue = isOverdue ? Math.round((cuota.amount * profile.loanLateFeeRate) / 100 * 100) / 100 : 0;
                  const st = INSTALLMENT_STATUS[cuota.status] ?? INSTALLMENT_STATUS.pending;
                  return (
                    <TableRow key={cuota.id} className={isOverdue ? 'bg-destructive/5' : undefined}>
                      <TableCell>{cuota.number}</TableCell>
                      <TableCell className={isOverdue ? 'text-destructive font-medium' : undefined}>
                        {dueDate.toLocaleDateString('es-DO')}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(cuota.amount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cuota.paidAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cuota.lateFeePaid)}</TableCell>
                      <TableCell>
                        {isOverdue ? (
                          <div className="flex flex-col">
                            <Badge variant="destructive" className="w-fit">Vencida</Badge>
                            {feeDue > cuota.lateFeePaid && (
                              <span className="text-xs text-destructive mt-1">
                                Mora: {formatCurrency(Math.max(feeDue - cuota.lateFeePaid, 0))}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant={st.variant} className={cuota.status === 'paid' ? 'bg-green-600' : undefined}>
                            {st.label}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial de Abonos</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aún no hay abonos registrados para este préstamo.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Mora</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.date.toLocaleString('es-DO')}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                    <TableCell className="text-right">{p.lateFeePaid > 0 ? formatCurrency(p.lateFeePaid) : '—'}</TableCell>
                    <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                    <TableCell>{p.userName ?? '—'}</TableCell>
                    <TableCell className="max-w-48 truncate" title={p.notes}>{p.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
