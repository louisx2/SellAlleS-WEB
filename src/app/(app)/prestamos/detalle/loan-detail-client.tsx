'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLoans } from '@/context/loan-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToLoanPayment, rowToRefinancing, rowToVehicleRecovery } from '@/lib/supabase/mappers';
import { cn, formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { FREQUENCY_LABEL } from '@/lib/frequency';
import { lateFeeDue, lateFeeModeHelp, overdueDays } from '@/lib/late-fee';
import type { LoanPayment, LoanPaymentMethod, Refinancing, VehicleRecovery } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DialogTrigger } from '@/components/ui/dialog';
import { RegisterLoanPaymentDialog } from '@/components/loans/register-loan-payment-dialog';
import { LoanTicketDialog } from '@/components/loans/loan-ticket-dialog';
import { VoidLoanPaymentDialog } from '@/components/loans/void-loan-payment-dialog';
import { RefinanceLoanDialog } from '@/components/loans/refinance-loan-dialog';
import { GarantiaCard } from '@/components/motos/garantia-card';
import { ArrowLeft, DollarSign, Printer, RefreshCw, Undo2 } from 'lucide-react';
// Un plan largo (cobro diario, semanal de 2 años) se muestra desde la próxima cuota a cobrar.
import { ventanaDeCuotas } from '@/lib/plan-largo';


const METHOD_LABEL: Record<LoanPaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  dacion: 'Dación en pago',
};

const INSTALLMENT_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  paid: { label: 'Pagada', variant: 'default' },
  partial: { label: 'Parcial', variant: 'secondary' },
  pending: { label: 'Pendiente', variant: 'outline' },
};

// Por qué se refinanció, quién y cuándo, y qué se hizo con la mora: va al pie
// de los avisos que enlazan el préstamo viejo con el nuevo.
function RefinancingNote({ refinancing: r }: { refinancing: Refinancing }) {
  return (
    <p className="basis-full text-muted-foreground">
      Motivo: {r.reason} · {r.createdByName ?? 'Usuario desconocido'}, {r.createdAt.toLocaleString('es-DO')}
      {r.lateFeeAmount > 0 && (
        <> · mora de {formatCurrency(r.lateFeeAmount)} {r.lateFeeAction === 'forgive' ? 'perdonada' : 'sumada al capital'}</>
      )}
    </p>
  );
}

export default function LoanDetailClient() {
  // Ruta estática con query param (?id=): más robusta que una ruta dinámica en
  // export estático (evita el 404 del payload RSC al navegar). Se lee en el
  // cliente (guardado por typeof window) porque no hay prerender del id.
  const [loanId, setLoanId] = useState<string>('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLoanId(new URLSearchParams(window.location.search).get('id') ?? '');
    }
  }, []);
  const { loans } = useLoans();
  const { appUser } = useAuth();
  const { profile } = useCompanyProfile();
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [voiding, setVoiding] = useState<LoanPayment | null>(null);
  const [isRefinanceOpen, setRefinanceOpen] = useState(false);
  const [refinancings, setRefinancings] = useState<Refinancing[]>([]);
  const [verTodasLasCuotas, setVerTodasLasCuotas] = useState(false);
  // Otra cuenta, otra vez plegada.
  useEffect(() => setVerTodasLasCuotas(false), [loanId]);

  const loan = loans.find((l) => l.id === loanId);
  // Anular un abono o refinanciar es cosa de administradores: las RPC lo exigen igual.
  const isAdmin = appUser?.role === 'admin';
  // Una refinanciación enlaza dos préstamos: el viejo queda cerrado y el nuevo
  // apunta a él con refinancedFromId.
  const refinancedTo = loan ? loans.find((l) => l.refinancedFromId === loan.id) : undefined;
  const refinancedFrom = loan?.refinancedFromId ? loans.find((l) => l.id === loan.refinancedFromId) : undefined;

  // El id se lee de la URL solo al montar, así que pasar a otro préstamo de
  // esta misma ruta (el nuevo tras refinanciar, o el viejo desde el nuevo) se
  // hace aquí: con un Link la pantalla seguiría mostrando el anterior.
  const goToLoan = (id: string, openTicket = false) => {
    window.history.replaceState(null, '', `/prestamos/detalle?id=${id}`);
    setLoanId(id);
    setTicketOpen(openTicket);
  };

  // Historial completo, anulados incluidos: se muestran tachados con su motivo.
  // Se refresca cuando el provider recarga los préstamos (tras abonar o anular).
  const loadPayments = useCallback(async () => {
    if (!loanId) return;
    const { data } = await supabase
      .from('loan_payments')
      .select('*')
      .eq('loan_id', loanId)
      .order('date', { ascending: false });
    if (data) setPayments(data.map(rowToLoanPayment));
  }, [loanId]);

  useEffect(() => { loadPayments(); }, [loadPayments, loans]);

  // Las refinanciaciones que tocan este préstamo: la que lo cerró (loan_id) y
  // la que lo creó (new_loan_id). La policy de `refinancings` es solo para
  // admins, igual que en el detalle del financiamiento.
  const loadRefinancings = useCallback(async () => {
    if (!loanId || !isAdmin) return;
    const { data } = await supabase
      .from('refinancings')
      .select('*')
      .or(`loan_id.eq.${loanId},new_loan_id.eq.${loanId}`);
    if (data) setRefinancings(data.map(rowToRefinancing));
  }, [loanId, isAdmin]);

  useEffect(() => { loadRefinancings(); }, [loadRefinancings, loans]);

  // Motopréstamos 4A: la última recuperación de la moto en garantía.
  const [garantia, setGarantia] = useState<VehicleRecovery | null>(null);
  useEffect(() => {
    setGarantia(null);
    if (!loanId) return;
    let cancelado = false;
    supabase.from('vehicle_recoveries').select('*').eq('loan_id', loanId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (!cancelado) setGarantia(data ? rowToVehicleRecovery(data) : null); });
    return () => { cancelado = true; };
  }, [loanId, loans]);

  // Se busca por el id actual: una respuesta tardía de otro préstamo no encaja.
  const refinancingOut = refinancings.find((r) => r.loanId === loanId);
  const refinancingIn = refinancings.find((r) => r.newLoanId === loanId);

  // Recién creado (?nuevo=1): abrir el ticket automáticamente una vez que el
  // préstamo (con su cronograma) ya cargó en el provider. Se lee la URL en el
  // cliente (no useSearchParams) para no requerir Suspense en export estático.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const esNuevo = new URLSearchParams(window.location.search).get('nuevo') === '1';
    if (esNuevo && loan?.installments?.length) {
      setTicketOpen(true);
    }
  }, [loan?.installments?.length]);

  const status = useMemo(
    () => (loan ? calculateLoanStatus(loan, profile.loanLateFeeRate, profile.loanLateFeeGraceDays) : null),
    [loan, profile.loanLateFeeRate, profile.loanLateFeeGraceDays],
  );

  // Aún leyendo el id de la URL o cargando la lista: no mostrar "no encontrado".
  if (!loanId) {
    return <div className="py-16 text-center text-muted-foreground">Cargando préstamo…</div>;
  }

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
  const isRefinanced = loan.status === 'refinanced';
  // Cerrado al liquidar la garantía con el saldo dado de baja: ya no recibe abonos.
  const isWrittenOff = loan.status === 'cancelled';
  const canRefinance = isAdmin && loan.status === 'active' && status.pendingBalance > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/prestamos">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setTicketOpen(true)}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir comprobante
        </Button>
        {canRefinance && (
          <Button variant="outline" onClick={() => setRefinanceOpen(true)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refinanciar
          </Button>
        )}
        {status.pendingBalance > 0 && !isWrittenOff && (
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {loan.customer?.name ?? 'Cliente'}
            {isRefinanced ? (
              <Badge variant="secondary">Refinanciado</Badge>
            ) : isWrittenOff ? (
              <Badge variant="secondary">Dado de baja</Badge>
            ) : status.pendingBalance <= 0 ? (
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
          {garantia && (garantia.status === 'incautada' || garantia.status === 'liquidada') && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100">
              <span>
                {garantia.status === 'incautada' ? (
                  <>Garantía incautada el {new Date(`${garantia.recoveredOn}T00:00:00`).toLocaleDateString('es-DO')}: la moto está en el patio y el préstamo sigue activo.</>
                ) : (
                  <>
                    Garantía liquidada{garantia.closedAt && <> el {garantia.closedAt.toLocaleDateString('es-DO')}</>}:{' '}
                    {garantia.liquidationMode === 'dacion' ? 'el negocio se quedó la moto' : 'la moto se vendió a un tercero'}
                    {garantia.proceeds != null && <> por {formatCurrency(garantia.proceeds)}</>}
                    {garantia.applied != null && <>; se aplicaron {formatCurrency(garantia.applied)} al préstamo</>}.
                    {garantia.writtenOff > 0 && <> Se dieron de baja {formatCurrency(garantia.writtenOff)}.</>}
                    {garantia.refunded > 0 && <> Sobraron {formatCurrency(garantia.refunded)} para el cliente.</>}
                  </>
                )}
              </span>
              <Link href={`/motos/ficha?id=${garantia.vehicleId}`} className="underline underline-offset-2">Ver la moto</Link>
            </div>
          )}
          {isWrittenOff && !(garantia?.status === 'liquidada' && garantia.writtenOff > 0) && loan.writtenOffAmount != null && (
            <div className="mb-4 rounded-lg border bg-muted/50 p-3 text-sm">
              Préstamo cerrado: se dieron de baja {formatCurrency(loan.writtenOffAmount)} y ya no recibe abonos.
            </div>
          )}
          {isRefinanced && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
              <span>
                Refinanciado{refinancedTo && <> el {refinancedTo.createdAt.toLocaleDateString('es-DO')}</>}: su saldo
                pasó a un préstamo nuevo y este ya no recibe abonos.
              </span>
              {refinancedTo && (
                <Button variant="link" className="h-auto p-0" onClick={() => goToLoan(refinancedTo.id)}>
                  Ver préstamo nuevo
                </Button>
              )}
              {refinancingOut && <RefinancingNote refinancing={refinancingOut} />}
            </div>
          )}
          {loan.refinancedFromId && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
              <span>
                Refinancia el préstamo{refinancedFrom && <> del {refinancedFrom.createdAt.toLocaleDateString('es-DO')}</>}:
                {' '}saldo anterior {formatCurrency(loan.carriedOverAmount)}
                {loan.principal - loan.carriedOverAmount > 0 && (
                  <> + entregado {formatCurrency(loan.principal - loan.carriedOverAmount)}</>
                )}.
              </span>
              {refinancedFrom && (
                <Button variant="link" className="h-auto p-0" onClick={() => goToLoan(refinancedFrom.id)}>
                  Ver préstamo anterior
                </Button>
              )}
              {refinancingIn && <RefinancingNote refinancing={refinancingIn} />}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Monto prestado</p>
              <p className="font-semibold">{formatCurrency(loan.principal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tasa mensual / Cuotas</p>
              <p className="font-semibold">{loan.interestRate}% · {loan.installmentsCount} cuotas ({FREQUENCY_LABEL[loan.paymentFrequency]})</p>
            </div>
            {isRefinanced ? (
              // Cerrado con total = pagado: "ganancia" saldría negativa. Lo que
              // importa aquí es cuánto se fue al préstamo nuevo.
              <div>
                <p className="text-muted-foreground">Pasó al préstamo nuevo</p>
                <p className="font-semibold">{refinancedTo ? formatCurrency(refinancedTo.carriedOverAmount) : '—'}</p>
              </div>
            ) : (
              <div>
                <p className="text-muted-foreground">Ganancia (interés)</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(loan.totalWithInterest - loan.principal)}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">Total a cobrar</p>
              <p className="font-semibold">{formatCurrency(loan.totalWithInterest)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Cobrado</p>
              <p className="font-semibold text-green-600">{formatCurrency(loan.amountPaid)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Por cobrar</p>
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
          {loan.disbursementMethod && (
            <p className="mt-4 text-sm text-muted-foreground border-t pt-3">
              {loan.disbursementMethod === 'cash'
                ? 'Entregado en efectivo'
                : `Entregado por transferencia${loan.disbursementReference ? ` (ref. ${loan.disbursementReference})` : ''}`}
            </p>
          )}
          {loan.notes && (
            <p className="mt-4 text-sm text-muted-foreground border-t pt-3">Notas: {loan.notes}</p>
          )}
        </CardContent>
      </Card>

      <GarantiaCard loanId={loan.id} />

      {loan.installments && loan.installments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan de Cuotas</CardTitle>
            <CardDescription>
              {lateFeeModeHelp(status.lateFeePolicy.mode, status.lateFeePolicy.rate, loan.paymentFrequency)}
              {' '}Se cobra antes que el capital al registrar un abono.
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
                {(verTodasLasCuotas ? loan.installments : ventanaDeCuotas(loan.installments).visibles).map((cuota) => {
                  const dueDate = new Date(cuota.dueDate + 'T00:00:00');
                  // Vencida = la que ya devenga mora, con la gracia del préstamo
                  // ya descontada. Misma cuenta que hace la base al cobrar.
                  const feeDue = cuota.status !== 'paid' ? lateFeeDue(cuota, status.lateFeePolicy, today) : 0;
                  const isOverdue =
                    cuota.status !== 'paid' &&
                    overdueDays(cuota.dueDate, today, status.lateFeePolicy.graceDays) > 0;
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
                  );
                })}
              </TableBody>
            </Table>
            {!verTodasLasCuotas && ventanaDeCuotas(loan.installments).ocultas > 0 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setVerTodasLasCuotas(true)}>
                Ver todas las cuotas ({loan.installments.length})
              </Button>
            )}
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
                  {isAdmin && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className={p.voidedAt ? 'opacity-60' : undefined}>
                    <TableCell>{p.date.toLocaleString('es-DO')}</TableCell>
                    <TableCell className={cn('text-right font-medium', p.voidedAt && 'line-through')}>
                      {formatCurrency(p.amount)}
                    </TableCell>
                    <TableCell className={cn('text-right', p.voidedAt && 'line-through')}>
                      {p.lateFeePaid > 0 ? formatCurrency(p.lateFeePaid) : '—'}
                    </TableCell>
                    <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                    <TableCell>{p.userName ?? '—'}</TableCell>
                    <TableCell className="max-w-48 truncate" title={p.voidedAt ? p.voidReason : p.notes}>
                      {p.voidedAt ? (
                        <span className="text-destructive">Anulado: {p.voidReason}</span>
                      ) : (p.notes ?? '—')}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {p.voidedAt ? (
                          <Badge variant="destructive" title={p.voidedByName ? `Anulado por ${p.voidedByName}` : undefined}>
                            Anulado
                          </Badge>
                        ) : isRefinanced ? (
                          // La base no deja anular abonos de un préstamo refinanciado.
                          <span className="text-xs text-muted-foreground" title="El préstamo se refinanció: sus abonos ya no se pueden anular.">
                            Cerrado
                          </span>
                        ) : p.method === 'dacion' || garantia?.paymentId === p.id ? (
                          // La liquidación de la garantía (dación o venta a un tercero) no se anula: la base lo rechaza.
                          <span className="text-xs text-muted-foreground" title="Es la liquidación de la garantía: la moto ya salió y no se anula.">
                            Liquidación
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
          )}
        </CardContent>
      </Card>

      <LoanTicketDialog loan={loan} isOpen={ticketOpen} onOpenChange={setTicketOpen} />

      {canRefinance && (
        <RefinanceLoanDialog
          loan={loan}
          open={isRefinanceOpen}
          onOpenChange={setRefinanceOpen}
          onRefinanced={(newLoanId) => goToLoan(newLoanId, true)}
        />
      )}

      {voiding && (
        <VoidLoanPaymentDialog
          payment={voiding}
          open={!!voiding}
          onOpenChange={(o) => !o && setVoiding(null)}
          onVoided={loadPayments}
        />
      )}
    </div>
  );
}
