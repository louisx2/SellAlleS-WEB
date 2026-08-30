'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSales } from '@/context/sales-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment } from '@/lib/supabase/mappers';
import { cn, formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import type { CreditPayment, PaymentMethod } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DialogTrigger } from '@/components/ui/dialog';
import { AddFinancingPaymentDialog } from '@/components/financing/add-financing-payment-dialog';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { VoidPaymentDialog } from '@/components/credit/void-payment-dialog';
import { ArrowLeft, DollarSign, Printer, Undo2 } from 'lucide-react';

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

export default function FinancingDetailClient() {
  const searchParams = useSearchParams();
  const saleId = searchParams.get('id') ?? '';
  // `financingSales` incluye el pool compartido: un financiamiento cobrable
  // desde esta sucursal pero originado en otra también abre su detalle.
  const { sales, financingSales } = useSales();
  const { appUser } = useAuth();
  const { profile } = useCompanyProfile();
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [isPlanOpen, setPlanOpen] = useState(false);
  const [voiding, setVoiding] = useState<CreditPayment | null>(null);

  const sale = financingSales.find(s => s.id === saleId) ?? sales.find(s => s.id === saleId);
  const canVoid = appUser?.role === 'admin';

  // Historial de abonos de esta venta; se refresca cuando el provider recarga
  // las ventas (p. ej. tras registrar un abono) y tras anular uno.
  const loadPayments = useCallback(async () => {
    if (!saleId) return;
    const { data } = await supabase
      .from('credit_payments')
      .select('*, branches(name)')
      .eq('sale_id', saleId)
      .order('date', { ascending: false });
    if (data) setPayments(data.map(rowToCreditPayment));
  }, [saleId]);

  useEffect(() => { loadPayments(); }, [loadPayments, sales]);

  const status = useMemo(
    () => (sale ? calculateFinancingStatus(sale, profile.lateFeeRate) : null),
    [sale, profile.lateFeeRate]
  );

  if (!sale || !status) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-10">
        <h1 className="text-2xl font-bold mb-4">Financiamiento no encontrado</h1>
        <p className="text-muted-foreground mb-6">No encontramos la venta con ID: {saleId}</p>
        <Button asChild>
          <Link href="/financing">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Financiamientos
          </Link>
        </Button>
      </div>
    );
  }

  const fin = sale.financingDetails;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/financing">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex gap-2">
          {fin && (
            <Button variant="outline" onClick={() => setPlanOpen(true)}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir Plan de Pagos
            </Button>
          )}
          {status.pendingBalance > 0 && (
            <AddFinancingPaymentDialog sale={sale}>
              <DialogTrigger asChild>
                <Button>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Registrar Abono
                </Button>
              </DialogTrigger>
            </AddFinancingPaymentDialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {sale.customer?.name ?? 'Consumidor Final'}
            {status.pendingBalance <= 0 ? (
              <Badge className="bg-green-600">Pagado</Badge>
            ) : status.isOverdue ? (
              <Badge variant="destructive">Atrasado</Badge>
            ) : (
              <Badge variant="outline">Al día</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Venta del {new Date(sale.createdAt).toLocaleDateString('es-DO')} · Sucursal {sale.branchId}
            {sale.ncf && <> · NCF {sale.ncf}</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total de la venta</p>
              <p className="font-semibold">{formatCurrency(sale.total)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Abono inicial</p>
              <p className="font-semibold">{formatCurrency(fin?.downPayment ?? 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tasa mensual / Cuotas</p>
              <p className="font-semibold">{fin ? `${fin.interestRate}% · ${fin.installments} cuotas` : 'Crédito simple'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total con intereses</p>
              <p className="font-semibold">{formatCurrency(fin?.totalWithInterest ?? sale.total)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Pagado</p>
              <p className="font-semibold text-green-600">{formatCurrency(sale.amountPaid)}</p>
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
        </CardContent>
      </Card>

      {sale.installments && sale.installments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan de Cuotas</CardTitle>
            <CardDescription>
              La mora ({profile.lateFeeRate}% por cuota vencida) se cobra primero al registrar un abono.
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
                {sale.installments.map((cuota) => {
                  const dueDate = new Date(cuota.dueDate + 'T00:00:00');
                  const isOverdue = cuota.status !== 'paid' && new Date(cuota.dueDate + 'T23:59:59') < today;
                  const feeDue = isOverdue
                    ? Math.round(cuota.amount * profile.lateFeeRate / 100 * 100) / 100
                    : 0;
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
          <CardDescription>
            Incluye el abono inicial de la venta. Un abono anulado queda a la vista, tachado y con su motivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aún no hay abonos registrados para esta venta.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Mora</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Notas</TableHead>
                    {canVoid && <TableHead className="text-right">Acción</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id} className={p.voidedAt ? 'opacity-60' : undefined}>
                      <TableCell className="whitespace-nowrap">{p.date.toLocaleString('es-DO')}</TableCell>
                      <TableCell className={cn('text-right font-medium', p.voidedAt && 'line-through')}>
                        {formatCurrency(p.amount)}
                      </TableCell>
                      <TableCell className={cn('text-right', p.voidedAt && 'line-through')}>
                        {p.lateFeePaid > 0 ? formatCurrency(p.lateFeePaid) : '—'}
                      </TableCell>
                      <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                      <TableCell className="max-w-40 truncate" title={p.reference}>{p.reference ?? '—'}</TableCell>
                      <TableCell>{p.branchId || '—'}</TableCell>
                      <TableCell>{p.userName ?? '—'}</TableCell>
                      <TableCell className="max-w-48 truncate" title={p.voidedAt ? p.voidReason : p.notes}>
                        {p.voidedAt ? (
                          <span className="text-destructive">Anulado: {p.voidReason}</span>
                        ) : (p.notes ?? '—')}
                      </TableCell>
                      {canVoid && (
                        <TableCell className="text-right">
                          {p.voidedAt ? (
                            <Badge variant="destructive">Anulado</Badge>
                          ) : p.kind === 'down_payment' ? (
                            <span className="text-xs text-muted-foreground" title="Es parte de la venta: se revierte anulando la venta completa.">
                              Inicial
                            </span>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setVoiding(p)}>
                              <Undo2 className="mr-1 h-3.5 w-3.5" />
                              Anular
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentPlanDialog sale={sale} isOpen={isPlanOpen} onOpenChange={setPlanOpen} />

      {voiding && (
        <VoidPaymentDialog
          payment={voiding}
          open={!!voiding}
          onOpenChange={(o) => !o && setVoiding(null)}
          onVoided={loadPayments}
        />
      )}
    </div>
  );
}
