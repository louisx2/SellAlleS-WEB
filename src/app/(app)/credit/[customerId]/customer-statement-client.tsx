'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useReactToPrint } from 'react-to-print';
import { useCustomers } from '@/context/customer-provider';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment } from '@/lib/supabase/mappers';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import type { CreditPayment, PaymentMethod } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DialogTrigger } from '@/components/ui/dialog';
import { AddPaymentDialog } from '@/components/credit/add-payment-dialog';
import { ArrowLeft, DollarSign, Printer } from 'lucide-react';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export default function CustomerStatementClient() {
  const params = useParams();
  const customerId = params.customerId as string;
  const { customers } = useCustomers();
  const { sales } = useSales();
  const { profile } = useCompanyProfile();
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const printRef = useRef(null);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  const customer = customers.find(c => c.id === customerId);

  // Historial completo de abonos del cliente (generales y por venta);
  // se refresca cuando el provider recarga las ventas tras un abono.
  useEffect(() => {
    if (!customerId) return;
    (async () => {
      const { data } = await supabase
        .from('credit_payments')
        .select('*, branches(name)')
        .eq('customer_id', customerId)
        .order('date', { ascending: false });
      if (data) setPayments(data.map(rowToCreditPayment));
    })();
  }, [customerId, sales]);

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-10">
        <h1 className="text-2xl font-bold mb-4">Cliente no encontrado</h1>
        <p className="text-muted-foreground mb-6">No encontramos el cliente con ID: {customerId}</p>
        <Button asChild>
          <Link href="/credit">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Cuentas por Cobrar
          </Link>
        </Button>
      </div>
    );
  }

  const openSales = sales.filter(
    s => s.customerId === customer.id
      && (s.paymentStatus === 'credit' || s.paymentStatus === 'in_financing')
  );
  const available = customer.creditLimit != null
    ? Math.max(customer.creditLimit - customer.creditBalance, 0)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href="/credit">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir Estado de Cuenta
          </Button>
          {customer.creditBalance > 0 && (
            <AddPaymentDialog customer={customer}>
              <DialogTrigger asChild>
                <Button>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Registrar Abono
                </Button>
              </DialogTrigger>
            </AddPaymentDialog>
          )}
        </div>
      </div>

      <div ref={printRef} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{customer.name}</CardTitle>
            <CardDescription>
              Estado de cuenta al {new Date().toLocaleDateString('es-DO')} · {profile.name}
              {customer.phone && <> · Tel: {customer.phone}</>}
              {customer.rnc && <> · RNC: {customer.rnc}</>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Deuda actual</p>
                <p className="text-xl font-bold text-destructive">{formatCurrency(customer.creditBalance)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Límite de crédito</p>
                <p className="text-xl font-bold">{customer.creditLimit != null ? formatCurrency(customer.creditLimit) : 'Sin límite'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Crédito disponible</p>
                <p className="text-xl font-bold text-green-600">{available != null ? formatCurrency(available) : '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ventas Pendientes de Pago</CardTitle>
          </CardHeader>
          <CardContent>
            {openSales.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                El cliente no tiene ventas a crédito abiertas.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openSales.map((sale) => {
                    const status = calculateFinancingStatus(sale, profile.lateFeeRate);
                    const isFinancing = sale.paymentStatus === 'in_financing';
                    return (
                      <TableRow key={sale.id}>
                        <TableCell>
                          <Link href={`/financing/${sale.id}`} className="underline underline-offset-2 print:no-underline">
                            {new Date(sale.createdAt).toLocaleDateString('es-DO')}
                          </Link>
                        </TableCell>
                        <TableCell>{isFinancing ? `Financiamiento (${status.installmentsPaid}/${status.totalInstallments} cuotas)` : 'Crédito'}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(sale.financingDetails?.totalWithInterest ?? sale.total)}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(sale.amountPaid)}</TableCell>
                        <TableCell className="text-right font-medium text-destructive">{formatCurrency(status.pendingBalance)}</TableCell>
                        <TableCell>
                          {status.isOverdue ? (
                            <Badge variant="destructive">Atrasada</Badge>
                          ) : (
                            <Badge variant="outline">Al día</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historial de Abonos</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Aún no hay abonos registrados.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Mora</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Aplicado a</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.date.toLocaleString('es-DO')}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                      <TableCell className="text-right">{p.lateFeePaid > 0 ? formatCurrency(p.lateFeePaid) : '—'}</TableCell>
                      <TableCell>{METHOD_LABEL[p.method]}</TableCell>
                      <TableCell>
                        {p.saleId ? (
                          <Link href={`/financing/${p.saleId}`} className="underline underline-offset-2 print:no-underline">
                            Venta específica
                          </Link>
                        ) : (
                          'Abono general'
                        )}
                      </TableCell>
                      <TableCell>{p.branchId || '—'}</TableCell>
                      <TableCell>{p.userName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
