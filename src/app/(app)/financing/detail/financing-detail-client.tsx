'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSales } from '@/context/sales-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment, rowToFinancingAmendment, rowToRefinancing } from '@/lib/supabase/mappers';
import { cn, formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { FREQUENCY_LABEL } from '@/lib/frequency';
import { lateFeeDue, lateFeeModeHelp, overdueDays } from '@/lib/late-fee';
import { formatQtyCompact } from '@/lib/units';
import type { CreditPayment, FinancingAmendment, PaymentMethod, Refinancing } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DialogTrigger } from '@/components/ui/dialog';
import { AddFinancingPaymentDialog } from '@/components/financing/add-financing-payment-dialog';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { VoidPaymentDialog } from '@/components/credit/void-payment-dialog';
import { AmendFinancingDialog } from '@/components/financing/amend-financing-dialog';
import { RescheduleInstallmentsDialog } from '@/components/financing/reschedule-installments-dialog';
import { RefinanceFinancingDialog } from '@/components/financing/refinance-financing-dialog';
import { ArrowLeft, CalendarClock, DollarSign, FileText, Pencil, Printer, RefreshCw, Undo2 } from 'lucide-react';

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
  const [amendments, setAmendments] = useState<FinancingAmendment[]>([]);
  const [isPlanOpen, setPlanOpen] = useState(false);
  const [isAmendOpen, setAmendOpen] = useState(false);
  const [voiding, setVoiding] = useState<CreditPayment | null>(null);
  const [isRescheduleOpen, setRescheduleOpen] = useState(false);
  const [refinancings, setRefinancings] = useState<Refinancing[]>([]);
  const [isRefinanceOpen, setRefinanceOpen] = useState(false);

  const sale = financingSales.find(s => s.id === saleId) ?? sales.find(s => s.id === saleId);
  // La factura solo abre las ventas propias de la sucursal: una del pool
  // compartido no está en `sales` y ahí daría "Venta no encontrada".
  const hasInvoice = sales.some(s => s.id === saleId);
  const isAdmin = appUser?.role === 'admin';

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

  // Bitácora de correcciones al plan. La policy solo la deja ver a admins, así
  // que para el resto ni se consulta.
  const loadAmendments = useCallback(async () => {
    if (!saleId || !isAdmin) return;
    const { data } = await supabase
      .from('financing_amendments')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false });
    if (data) setAmendments(data.map(rowToFinancingAmendment));
  }, [saleId, isAdmin]);

  // Refinanciaciones de esta venta: misma regla de visibilidad que las
  // correcciones (la policy de `refinancings` es solo para admins).
  const loadRefinancings = useCallback(async () => {
    if (!saleId || !isAdmin) return;
    const { data } = await supabase
      .from('refinancings')
      .select('*')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false });
    if (data) setRefinancings(data.map(rowToRefinancing));
  }, [saleId, isAdmin]);

  useEffect(() => { loadPayments(); }, [loadPayments, sales]);
  useEffect(() => { loadAmendments(); }, [loadAmendments, sales]);
  useEffect(() => { loadRefinancings(); }, [loadRefinancings, sales]);

  const status = useMemo(
    () => (sale ? calculateFinancingStatus(sale, profile.lateFeeRate, profile.lateFeeGraceDays) : null),
    [sale, profile.lateFeeRate, profile.lateFeeGraceDays]
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
  // La política del plan es la que va a cobrar la RPC de abonos: se congeló al
  // crearlo. Los planes viejos no la traen y siguen la de la empresa.
  const policy = status.lateFeePolicy;
  const frequency = fin?.frequency ?? 'monthly';
  // Mismo criterio que la base: solo admin, venta viva y alguna cuota por pagar.
  const canReschedule =
    isAdmin && !sale.cancelledAt && !!sale.installments?.some((cuota) => cuota.status !== 'paid');
  // Refinanciado: las cuotas con número menor a firstInstallment son del plan
  // viejo, cerradas con lo pagado. Corregir el plan ya no aplica (la base lo
  // rechaza: rearmaría el calendario desde la venta).
  const refinancedAt = fin?.refinancedAt ? new Date(fin.refinancedAt) : null;
  const firstInstallment = fin?.firstInstallment ?? 1;
  const canRefinance = !!fin && isAdmin && !sale.cancelledAt && status.pendingBalance > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/financing">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {hasInvoice && (
            <Button asChild variant="outline">
              <Link href={`/sales/detail?id=${sale.id}`}>
                <FileText className="mr-2 h-4 w-4" />
                Ver Factura
              </Link>
            </Button>
          )}
          {fin && (
            <Button variant="outline" onClick={() => setPlanOpen(true)}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir Plan de Pagos
            </Button>
          )}
          {fin && isAdmin && !sale.cancelledAt && !refinancedAt && (
            <Button variant="outline" onClick={() => setAmendOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Corregir Plan
            </Button>
          )}
          {canRefinance && (
            <Button variant="outline" onClick={() => setRefinanceOpen(true)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refinanciar
            </Button>
          )}
          {status.pendingBalance > 0 && !sale.cancelledAt && (
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
            {sale.cancelledAt ? (
              <Badge variant="destructive">Anulada</Badge>
            ) : status.pendingBalance <= 0 ? (
              <Badge className="bg-green-600">Pagado</Badge>
            ) : status.isOverdue ? (
              <Badge variant="destructive">Atrasado</Badge>
            ) : (
              <Badge variant="outline">Al día</Badge>
            )}
            {refinancedAt && <Badge variant="secondary">Refinanciado</Badge>}
          </CardTitle>
          <CardDescription>
            Venta del {new Date(sale.createdAt).toLocaleDateString('es-DO')} · Sucursal {sale.branchId}
            {sale.ncf && <> · NCF {sale.ncf}</>}
            {refinancedAt && <> · Refinanciado el {refinancedAt.toLocaleDateString('es-DO')}</>}
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
              <p className="text-muted-foreground">
                {fin?.interestMode === 'per_installment' ? 'Tasa por cuota / Cuotas' : 'Tasa mensual / Cuotas'}
              </p>
              <p className="font-semibold">
                {fin
                  ? `${fin.interestRate}% · ${fin.installments} cuotas (${FREQUENCY_LABEL[frequency]})`
                  : 'Crédito simple'}
              </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Artículos Financiados</CardTitle>
          <CardDescription>Lo que se llevó el cliente en esta venta, al precio que se le cobró.</CardDescription>
        </CardHeader>
        <CardContent>
          {sale.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Esta venta no tiene artículos registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sale.items.map((item) => {
                    const price = item.customPrice ?? item.product.price;
                    return (
                      <TableRow key={item.cartItemId}>
                        <TableCell className="font-medium">{item.product.name}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {formatQtyCompact(item.quantity, item.product.unit)}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(price)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(price * item.quantity)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                {/* Con ITBIS sumado encima, las líneas no llegan solas al total. */}
                <TableFooter>
                  {!sale.itbisIncluded && sale.itbisAmount > 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-right font-normal">ITBIS</TableCell>
                      <TableCell className="text-right font-normal">{formatCurrency(sale.itbisAmount)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right">Total de la venta</TableCell>
                    <TableCell className="text-right">{formatCurrency(sale.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {sale.installments && sale.installments.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Plan de Cuotas</CardTitle>
              <CardDescription>
                {lateFeeModeHelp(policy.mode, policy.rate, frequency)} Se cobra antes que el capital
                al registrar un abono.
              </CardDescription>
            </div>
            {canReschedule && (
              <Button variant="outline" size="sm" onClick={() => setRescheduleOpen(true)}>
                <CalendarClock className="mr-2 h-4 w-4" />
                Cambiar fechas
              </Button>
            )}
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
                  // Vencida = la que ya devenga mora, con la gracia del plan ya
                  // descontada. Misma cuenta que hace la base al cobrar.
                  const feeDue = cuota.status !== 'paid' ? lateFeeDue(cuota, policy, today) : 0;
                  const isOverdue =
                    cuota.status !== 'paid' && overdueDays(cuota.dueDate, today, policy.graceDays) > 0;
                  const st = INSTALLMENT_STATUS[cuota.status] ?? INSTALLMENT_STATUS.pending;
                  // Donde arranca el plan nuevo, una línea que lo separa del viejo.
                  const startsNewPlan = refinancedAt && cuota.number === firstInstallment && firstInstallment > 1;
                  return (
                    <Fragment key={cuota.id}>
                    {startsNewPlan && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={6} className="text-xs font-medium text-muted-foreground">
                          Plan refinanciado el {refinancedAt.toLocaleDateString('es-DO')}
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow className={isOverdue ? 'bg-destructive/5' : undefined}>
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
                            {feeDue > 0 && (
                              <span className="text-xs text-destructive mt-1">
                                Mora: {formatCurrency(feeDue)}
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
                    </Fragment>
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
                    {isAdmin && <TableHead className="text-right">Acción</TableHead>}
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
                      {isAdmin && (
                        <TableCell className="text-right">
                          {p.voidedAt ? (
                            <Badge variant="destructive">Anulado</Badge>
                          ) : p.kind === 'down_payment' ? (
                            <span className="text-xs text-muted-foreground" title="Es parte de la venta: se revierte anulando la venta completa.">
                              Inicial
                            </span>
                          ) : refinancedAt && p.date < refinancedAt ? (
                            // Pagó cuotas del plan que la refinanciación cerró: la base no deja anularlo.
                            <span className="text-xs text-muted-foreground" title="Es anterior a la refinanciación: ya no se puede anular.">
                              Cerrado
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

      {refinancings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Refinanciaciones</CardTitle>
            <CardDescription>
              Cada vez que lo que se debía pasó a un plan nuevo: sobre qué monto, qué se hizo con la mora
              y por qué.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {refinancings.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.createdAt.toLocaleString('es-DO')}</span>
                  <span className="text-muted-foreground">{r.createdByName ?? 'Usuario desconocido'}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.reason}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Se debía</p>
                    <p className="font-medium">{formatCurrency(r.pendingBalance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Base</p>
                    <p className="font-medium">
                      {r.baseMode === 'capital'
                        ? `Solo capital (${formatCurrency(r.pendingCapital)})`
                        : 'Saldo completo'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Mora</p>
                    <p className="font-medium">
                      {r.lateFeeAmount <= 0
                        ? '—'
                        : `${formatCurrency(r.lateFeeAmount)} ${r.lateFeeAction === 'forgive' ? 'perdonada' : 'sumada'}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Capital nuevo</p>
                    <p className="font-medium text-primary">{formatCurrency(r.newPrincipal)}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {amendments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Correcciones al Plan</CardTitle>
            <CardDescription>
              Cada vez que se corrigieron los términos de este financiamiento, con el antes y el después.
              Si el cliente tiene un recibo viejo, aquí está por qué ya no coincide.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {amendments.map((a) => (
              <div key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{a.createdAt.toLocaleString('es-DO')}</span>
                  <span className="text-muted-foreground">{a.changedByName ?? 'Usuario desconocido'}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{a.reason}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <AmendField label="Tasa" before={`${a.before.interestRate}%`} after={`${a.after.interestRate}%`} />
                  <AmendField label="Cuotas" before={`${a.before.installments}`} after={`${a.after.installments}`} />
                  <AmendField
                    label="Cuota"
                    before={formatCurrency(a.before.installmentAmount)}
                    after={formatCurrency(a.after.installmentAmount)}
                  />
                  <AmendField
                    label="Total con interés"
                    before={formatCurrency(a.before.totalWithInterest)}
                    after={formatCurrency(a.after.totalWithInterest)}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <PaymentPlanDialog sale={sale} isOpen={isPlanOpen} onOpenChange={setPlanOpen} />

      <AmendFinancingDialog
        sale={sale}
        open={isAmendOpen}
        onOpenChange={setAmendOpen}
        onAmended={loadAmendments}
      />

      {canRefinance && (
        <RefinanceFinancingDialog
          sale={sale}
          open={isRefinanceOpen}
          onOpenChange={setRefinanceOpen}
          onRefinanced={loadRefinancings}
        />
      )}

      {isRescheduleOpen && (
        <RescheduleInstallmentsDialog
          sale={sale}
          open={isRescheduleOpen}
          onOpenChange={setRescheduleOpen}
          graceDays={policy.graceDays}
        />
      )}

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

// Un campo del antes/después: lo que no cambió se muestra una sola vez, para
// que salte a la vista qué fue lo que se tocó.
function AmendField({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {changed ? (
        <p className="font-medium">
          <span className="text-muted-foreground line-through">{before}</span>
          {' → '}
          <span className="text-primary">{after}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">{after}</p>
      )}
    </div>
  );
}
