'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReactToPrint } from 'react-to-print';
import { ArrowRight, CalendarClock, DollarSign, FileText, ListChecks, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment } from '@/lib/supabase/mappers';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { estadoDisponible } from '@/lib/estado-financiamiento';
import { useCompanyProfile } from '@/context/company-profile-provider';
import type { CreditPayment, PaymentMethod, Sale } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { CompartirDocumento } from '@/components/sharing/compartir-documento';
import { FinancingStatementContent } from '@/components/financing/financing-statement-content';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

/**
 * Abonos recibidos por una venta a crédito o financiada, para verlos en el
 * mismo detalle de la venta. El historial completo vive en /financing/detail y
 * /credit/statement, pero esta es la pantalla donde se buscan primero.
 *
 * No se muestra nada si la venta se pagó de contado.
 */
export function SalePaymentsCard({ sale }: { sale: Sale }) {
  const { profile } = useCompanyProfile();
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // Copias del estado del financiamiento para imprimir y para el PDF, como en
  // su diálogo: el cuadro lo manda sin tener que abrirlo.
  const estadoPrintRef = useRef<HTMLDivElement>(null);
  const estadoPdfRef = useRef<HTMLDivElement>(null);
  const imprimirEstado = useReactToPrint({
    content: () => estadoPrintRef.current,
  });

  // Una venta queda debiendo por su estado, no por el método: pagar de menos en
  // efectivo también deja deuda (cart-provider.tsx), con payment_method 'cash'.
  const abierta = sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing';

  useEffect(() => {
    let cancelado = false;
    // Se limpia antes de pedir: al saltar de un recibo a otro por la misma ruta
    // el componente no se vuelve a montar y se verían los abonos del anterior.
    setPayments([]);
    setError(false);
    setLoading(true);
    (async () => {
      const { data, error: err } = await supabase
        .from('credit_payments')
        .select('*, branches(name)')
        .eq('sale_id', sale.id)
        // Un abono anulado nunca fue dinero: la propia columna lo advierte.
        .is('voided_at', null)
        .order('date', { ascending: false });
      if (cancelado) return;
      // Sin esto, una consulta fallida se vería igual que "no tiene abonos".
      if (err) setError(true);
      else setPayments(data ? data.map(rowToCreditPayment) : []);
      setLoading(false);
    })();
    return () => { cancelado = true; };
  }, [sale.id]);

  // En una venta que ya no debe nada la tarjeta solo aparece si de verdad tuvo
  // abonos —una venta de contado no tiene nada que mostrar—, y se espera a
  // saberlo para no hacerla parpadear en cada recibo.
  if (!abierta && (loading || payments.length === 0)) return null;

  const status = calculateFinancingStatus(sale, profile.lateFeeRate, profile.lateFeeGraceDays);
  const esFinanciamiento = !!sale.financingDetails || sale.paymentStatus === 'in_financing';
  const deuda = esFinanciamiento && sale.financingDetails
    ? Number(sale.financingDetails.totalWithInterest)
    : sale.total;
  // El inicial solo se afirma cuando la venta lo guarda (financiamiento).
  // Despejarlo de amount_paid en crédito simple da de más si el cliente abonó
  // por deuda general, así que ahí se omite y se muestra solo el pagado, que
  // siempre es exacto.
  const inicial = sale.financingDetails?.downPayment != null
    ? Number(sale.financingDetails.downPayment)
    : null;
  const saldado = status.pendingBalance <= 0.01;

  // El historial completo de un financiamiento está en su detalle; el de una
  // venta a crédito simple, en el estado de cuenta del cliente.
  const verTodo = esFinanciamiento
    ? `/financing/detail?id=${sale.id}`
    : sale.customerId
      ? `/credit/statement?id=${sale.customerId}`
      : null;

  // Los documentos del financiamiento, como los del recibo de arriba. Una venta
  // anulada no debe nada: su estado le diría al cliente lo contrario.
  const conDocumentos = esFinanciamiento && estadoDisponible(sale);
  // El estado lleva los pagos: sin ellos diría que el cliente no ha abonado.
  const estadoListo = !loading && !error;

  return (
    <Card className="mt-6 print:hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Abonos de esta venta
            {sale.recoveredAt
              // Moto recuperada (4A): no se cobró entera, el resto se dio de baja.
              ? <Badge variant="outline" className="text-orange-700 border-orange-700">Recuperada</Badge>
              : saldado
              ? <Badge className="bg-green-600">Saldada</Badge>
              : <Badge variant="destructive">Debe {formatCurrency(status.pendingBalance)}</Badge>}
          </CardTitle>
          <CardDescription>
            {esFinanciamiento ? 'Financiamiento' : 'Venta a crédito'} por {formatCurrency(deuda)}
            {inicial != null && inicial > 0 && <> · inicial {formatCurrency(inicial)}</>}
            {' · '}pagado {formatCurrency(sale.amountPaid)}
          </CardDescription>
        </div>
        {/* Con documentos, el enlace al financiamiento va en su bloque. */}
        {verTodo && !conDocumentos && (
          <Button asChild variant="outline" size="sm">
            <Link href={verTodo}>
              <FileText className="mr-1.5 h-4 w-4" />
              {esFinanciamiento ? 'Ver financiamiento' : 'Estado de cuenta'}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {conDocumentos && (
          <div className="mb-4 rounded-lg border bg-muted/40">
            <div className="space-y-3 p-3">
              <div className="flex items-start gap-2.5">
                <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium leading-tight">Estado del financiamiento</p>
                  <p className="text-xs text-muted-foreground">
                    Cuotas, pagos realizados y balance pendiente, listo para el cliente.
                  </p>
                </div>
              </div>
              <CompartirDocumento
                sale={sale}
                documento="estado"
                pdfRef={estadoPdfRef}
                onImprimir={imprimirEstado}
                disabled={!estadoListo}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t px-1.5 py-1.5">
              {sale.financingDetails && (
                <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}>
                  <CalendarClock className="mr-1.5 h-4 w-4" />
                  Plan de pagos
                </Button>
              )}
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <Link href={`/financing/detail?id=${sale.id}`}>
                  Ver financiamiento
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No se pudieron cargar los abonos de esta venta.
          </p>
        ) : payments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {saldado
              ? 'Quedó saldada sin abonos a su nombre: se cobró con abonos generales a la deuda del cliente.'
              : 'Todavía no se ha recibido ningún abono por esta venta.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Mora</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    {p.date.toLocaleDateString('es-DO')}
                    {p.userName && (
                      <span className="block text-xs text-muted-foreground">{p.userName}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.reference && (
                      <span className="block text-xs text-muted-foreground">{p.reference}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-orange-500">
                    {p.lateFeePaid > 0 ? formatCurrency(p.lateFeePaid) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && !error && payments.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            {payments.length} {payments.length === 1 ? 'abono recibido' : 'abonos recibidos'} por
            {' '}{formatCurrency(payments.reduce((a, p) => a + p.amount, 0))}
          </p>
        )}
      </CardContent>

      {conDocumentos && (
        <>
          {estadoListo && (
            <>
              {/* Copia oculta para impresión */}
              <div className="hidden">
                <div ref={estadoPrintRef} className="receipt-container">
                  <FinancingStatementContent sale={sale} payments={payments} />
                </div>
              </div>
              {/* Copia fuera de pantalla, a 100 mm como el ticket, de la que
                  sale el PDF (ver la nota en receipt-dialog). */}
              <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                <div ref={estadoPdfRef} className="bg-white text-black w-[100mm] p-4">
                  <FinancingStatementContent sale={sale} payments={payments} />
                </div>
              </div>
            </>
          )}
          <PaymentPlanDialog sale={sale} isOpen={planOpen} onOpenChange={setPlanOpen} />
        </>
      )}
    </Card>
  );
}
