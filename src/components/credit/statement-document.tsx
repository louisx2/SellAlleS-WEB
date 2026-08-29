'use client';

import type { Customer, CreditPayment, PaymentMethod, Sale } from '@/lib/types';
import { useTicketProfile, type TicketProfile } from '@/hooks/use-ticket-profile';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { BusinessHeader, BusinessFooter, DocumentBarcode } from '@/components/print/business-header';

// El estado de cuenta impreso, con la misma cara que la factura: mismo
// encabezado, mismos separadores punteados, mismo pie. Antes salían las
// tarjetas de la pantalla tal cual y no parecían del mismo negocio.
//
// Dos formatos porque sirven para cosas distintas: el ticket se le entrega al
// cliente en el mostrador por la misma impresora del recibo, y la hoja se
// manda por correo o se archiva. El contenido es el mismo; cambia cómo se
// acomodan las listas, que en 76 mm no caben en columnas.

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export type FormatoEstadoCuenta = 'ticket' | 'hoja';

export interface OpcionesEstadoCuenta {
  formato: FormatoEstadoCuenta;
  /** El límite de crédito y el disponible son datos internos: no siempre se le
   *  quieren enseñar al cliente en un papel que se lleva. */
  mostrarLimite: boolean;
  mostrarAbonos: boolean;
}

interface Props {
  customer: Customer;
  ventasAbiertas: Sale[];
  abonos: CreditPayment[];
  lateFeeRate?: number;
  opciones: OpcionesEstadoCuenta;
}

/** En 76 mm un historial de años deja el papel por el suelo. */
const ABONOS_EN_TICKET = 10;

function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? 'font-bold' : ''}`}>
      <span className="uppercase">{etiqueta}</span>
      <span>{valor}</span>
    </div>
  );
}

/** Toma el perfil del negocio de la sucursal activa y pinta la vista. */
export function StatementDocument(props: Props) {
  const profile = useTicketProfile();
  return <StatementDocumentView {...props} profile={profile} />;
}

/**
 * La vista, sin hooks de datos: recibe todo por props. Separada del contenedor
 * para poder mirarla con datos de mentira sin montar media aplicación.
 */
export function StatementDocumentView({
  customer, ventasAbiertas, abonos, lateFeeRate, opciones, profile,
}: Props & { profile: TicketProfile }) {
  const esTicket = opciones.formato === 'ticket';

  const disponible = customer.creditLimit != null
    ? Math.max(customer.creditLimit - customer.creditBalance, 0)
    : null;

  const totalPendiente = ventasAbiertas.reduce(
    (acc, v) => acc + calculateFinancingStatus(v, lateFeeRate).pendingBalance, 0
  );

  const abonosMostrados = esTicket ? abonos.slice(0, ABONOS_EN_TICKET) : abonos;
  const abonosOcultos = abonos.length - abonosMostrados.length;

  return (
    <div className={esTicket ? 'space-y-4' : 'space-y-5'}>
      <BusinessHeader profile={profile} />

      <Separator className="my-2" />
      <div className="text-sm pt-1">
        <p className="text-left text-xs font-semibold uppercase">Estado de Cuenta</p>
        <p className="text-left text-xs uppercase">Fecha: {new Date().toLocaleString('es-DO')}</p>
        {profile.name && <p className="text-left text-xs uppercase">Sucursal: {profile.name}</p>}
      </div>

      <Separator className="my-2" />
      <div className="text-left pt-1 text-xs">
        <p className="font-semibold uppercase">Cliente: {customer.name}</p>
        {customer.rnc && <p><span className="font-semibold uppercase">RNC:</span> {customer.rnc}</p>}
        {customer.phone && <p><span className="font-semibold uppercase">Tel:</span> {customer.phone}</p>}
      </div>

      <Separator className="my-2" />
      <div className="space-y-0.5 text-xs">
        <Fila etiqueta="Deuda actual:" valor={formatCurrency(customer.creditBalance)} fuerte />
        {opciones.mostrarLimite && (
          <>
            <Fila
              etiqueta="Límite de crédito:"
              valor={customer.creditLimit != null ? formatCurrency(customer.creditLimit) : 'Sin límite'}
            />
            <Fila etiqueta="Crédito disponible:" valor={disponible != null ? formatCurrency(disponible) : '—'} />
          </>
        )}
      </div>

      {/* --- Ventas pendientes --- */}
      <div className="py-3 border-t border-b border-dashed border-foreground/50 font-mono text-xs">
        <p className="font-semibold uppercase mb-2 font-sans">Ventas pendientes de pago</p>

        {ventasAbiertas.length === 0 ? (
          <p className="text-center py-2">Sin ventas a crédito abiertas.</p>
        ) : esTicket ? (
          <div className="space-y-3">
            {ventasAbiertas.map((venta) => {
              const estado = calculateFinancingStatus(venta, lateFeeRate);
              const esFinanciamiento = venta.paymentStatus === 'in_financing';
              return (
                <div key={venta.id}>
                  <p>
                    {new Date(venta.createdAt).toLocaleDateString('es-DO')}
                    {' · '}
                    {esFinanciamiento
                      ? `Financiamiento (${estado.installmentsPaid}/${estado.totalInstallments})`
                      : 'Crédito'}
                    {estado.isOverdue ? ' · ATRASADA' : ''}
                  </p>
                  <div className="pl-2">
                    <Fila
                      etiqueta="Total"
                      valor={formatCurrency(venta.financingDetails?.totalWithInterest ?? venta.total)}
                    />
                    <Fila etiqueta="Pagado" valor={formatCurrency(venta.amountPaid)} />
                    <Fila etiqueta="Pendiente" valor={formatCurrency(estado.pendingBalance)} fuerte />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-dashed">
                <th className="py-1 font-semibold uppercase">Fecha</th>
                <th className="py-1 font-semibold uppercase">Tipo</th>
                <th className="py-1 font-semibold uppercase text-right">Total</th>
                <th className="py-1 font-semibold uppercase text-right">Pagado</th>
                <th className="py-1 font-semibold uppercase text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {ventasAbiertas.map((venta) => {
                const estado = calculateFinancingStatus(venta, lateFeeRate);
                const esFinanciamiento = venta.paymentStatus === 'in_financing';
                return (
                  <tr key={venta.id} className="border-b border-dotted last:border-0">
                    <td className="py-1">{new Date(venta.createdAt).toLocaleDateString('es-DO')}</td>
                    <td className="py-1">
                      {esFinanciamiento
                        ? `Financiamiento ${estado.installmentsPaid}/${estado.totalInstallments}`
                        : 'Crédito'}
                      {estado.isOverdue ? ' (atrasada)' : ''}
                    </td>
                    <td className="py-1 text-right">
                      {formatCurrency(venta.financingDetails?.totalWithInterest ?? venta.total)}
                    </td>
                    <td className="py-1 text-right">{formatCurrency(venta.amountPaid)}</td>
                    <td className="py-1 text-right font-semibold">{formatCurrency(estado.pendingBalance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-between items-baseline font-bold">
        <span className="text-base uppercase">Total adeudado:</span>
        <span className="text-lg">{formatCurrency(totalPendiente)}</span>
      </div>

      {/* --- Abonos --- */}
      {opciones.mostrarAbonos && (
        <>
          <Separator className="my-2" />
          <div className="font-mono text-xs">
            <p className="font-semibold uppercase mb-2 font-sans">Historial de abonos</p>
            {abonos.length === 0 ? (
              <p className="text-center py-2">Aún no hay abonos registrados.</p>
            ) : esTicket ? (
              <div className="space-y-1">
                {abonosMostrados.map((abono) => (
                  <div key={abono.id}>
                    <Fila
                      etiqueta={`${abono.date.toLocaleDateString('es-DO')} ${METHOD_LABEL[abono.method]}`}
                      valor={formatCurrency(abono.amount)}
                    />
                  </div>
                ))}
                {abonosOcultos > 0 && (
                  <p className="pt-1">…y {abonosOcultos} abono{abonosOcultos === 1 ? '' : 's'} anterior{abonosOcultos === 1 ? '' : 'es'}.</p>
                )}
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-dashed">
                    <th className="py-1 font-semibold uppercase">Fecha</th>
                    <th className="py-1 font-semibold uppercase text-right">Monto</th>
                    <th className="py-1 font-semibold uppercase text-right">Mora</th>
                    <th className="py-1 font-semibold uppercase">Método</th>
                    <th className="py-1 font-semibold uppercase">Aplicado a</th>
                  </tr>
                </thead>
                <tbody>
                  {abonos.map((abono) => (
                    <tr key={abono.id} className="border-b border-dotted last:border-0">
                      <td className="py-1">{abono.date.toLocaleDateString('es-DO')}</td>
                      <td className="py-1 text-right font-semibold">{formatCurrency(abono.amount)}</td>
                      <td className="py-1 text-right">{abono.lateFeePaid > 0 ? formatCurrency(abono.lateFeePaid) : '—'}</td>
                      <td className="py-1">{METHOD_LABEL[abono.method]}</td>
                      <td className="py-1">{abono.saleId ? 'Venta específica' : 'Abono general'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <BusinessFooter profile={profile} codigo={<DocumentBarcode valor={customer.id} />} />
    </div>
  );
}
