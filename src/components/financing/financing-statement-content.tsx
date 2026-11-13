'use client';

import { Separator } from '@/components/ui/separator';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { calculateFinancingStatus, formatCurrency } from '@/lib/utils';
import { overdueDays } from '@/lib/late-fee';
import { abonosDelEstado } from '@/lib/estado-financiamiento';
import type { CreditPayment, PaymentMethod, Sale } from '@/lib/types';

const METODO: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const ESTADO_CUOTA: Record<string, string> = {
  paid: 'Pagada',
  partial: 'Parcial',
  pending: 'Pendiente',
};

interface FinancingStatementContentProps {
  sale: Sale;
  /** Abonos de la venta tal como los carga el detalle (incluye anulados). */
  payments: CreditPayment[];
}

/** Estado del financiamiento para el cliente: cuánto lleva pagado, cuánto
 *  debe, cada cuota con su estado y los pagos que ha hecho. Mismo formato de
 *  ticket que el plan de pagos, para imprimirlo o mandarlo en PDF. */
export function FinancingStatementContent({ sale, payments }: FinancingStatementContentProps) {
  // Perfil de la sucursal de la venta (branchId guarda el nombre), con herencia de la empresa.
  const profile = useTicketProfile(sale.branchId);
  const { profile: company } = useCompanyProfile();
  const fin = sale.financingDetails;
  const status = calculateFinancingStatus(sale, company.lateFeeRate, company.lateFeeGraceDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Igual que el plan: si se refinanció, las cuotas del plan viejo van
  // resumidas en una línea y la tabla muestra solo el plan vigente.
  const firstInstallment = fin?.firstInstallment ?? 1;
  const refinancedAt = fin?.refinancedAt ? new Date(fin.refinancedAt) : null;
  const cuotas = (sale.installments ?? []).filter((i) => i.number >= firstInstallment);
  const pagadoPlanAnterior = (sale.installments ?? [])
    .filter((i) => i.number < firstInstallment)
    .reduce((acc, i) => acc + i.amount, 0);
  const abonos = abonosDelEstado(payments);

  return (
    <div className="text-left space-y-1">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 85, maxWidth: '80%', objectFit: 'contain' }} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-center">{profile.name}</h3>
      {profile.secondaryName && <p className="text-sm font-medium text-center">{profile.secondaryName}</p>}
      <div className="text-xs text-muted-foreground text-center">
        {profile.address && <p>{profile.address}</p>}
        {profile.rnc && <p>RNC: {profile.rnc}</p>}
        {profile.phone && <p>Tel: {profile.phone}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-xs pt-1 space-y-0.5">
        <p className="font-semibold uppercase">Estado del Financiamiento</p>
        <p className="uppercase">Venta: #{sale.id.slice(0, 8).toUpperCase()}</p>
        <p className="uppercase">Fecha de la venta: {new Date(sale.createdAt).toLocaleDateString('es-DO')}</p>
        <p className="uppercase">Estado al: {today.toLocaleDateString('es-DO')}</p>
        {refinancedAt && (
          <p className="font-semibold uppercase">Refinanciado el {refinancedAt.toLocaleDateString('es-DO')}</p>
        )}
        <p className="uppercase">Sucursal: {sale.branchId || 'Principal'}</p>
        <p className="font-semibold uppercase">Cliente: {sale.customer?.name ?? 'Consumidor Final'}</p>
      </div>
      <Separator className="my-2" />
      <div className="text-xs space-y-1 py-1">
        <div className="flex justify-between">
          <span>Total a pagar (con intereses):</span>
          <span>{formatCurrency(fin?.totalWithInterest ?? sale.total)}</span>
        </div>
        {refinancedAt && (
          <div className="flex justify-between">
            <span>Plan anterior: pagado</span>
            <span>{formatCurrency(pagadoPlanAnterior)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Pagado:</span>
          <span>{formatCurrency(sale.amountPaid)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Balance pendiente:</span>
          <span>{formatCurrency(status.pendingBalance)}</span>
        </div>
        {status.lateFee > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Mora pendiente:</span>
            <span>{formatCurrency(status.lateFee)}</span>
          </div>
        )}
        {status.totalInstallments > 0 && (
          <div className="flex justify-between">
            <span>Cuotas pagadas:</span>
            <span>{status.installmentsPaid} de {status.totalInstallments}</span>
          </div>
        )}
        {status.nextDueDate && status.pendingBalance > 0 && (
          <div className="flex justify-between">
            <span>Próximo vencimiento:</span>
            <span>{status.nextDueDate.toLocaleDateString('es-DO')}</span>
          </div>
        )}
      </div>

      {cuotas.length > 0 && (
        <>
          <Separator className="my-2" />
          <p className="text-xs font-semibold uppercase">Cuotas</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-dashed border-foreground/50 text-left">
                <th className="py-1 font-semibold">No.</th>
                <th className="py-1 font-semibold">Vence</th>
                <th className="py-1 font-semibold text-right">Cuota</th>
                <th className="py-1 font-semibold text-right">Pagado</th>
                <th className="py-1 font-semibold text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((cuota) => {
                // Vencida con la misma cuenta que la base (gracia descontada).
                const vencida =
                  cuota.status !== 'paid' && overdueDays(cuota.dueDate, today, status.lateFeePolicy.graceDays) > 0;
                return (
                  <tr key={cuota.id} className="border-b border-dotted border-foreground/20">
                    <td className="py-1">{cuota.number}</td>
                    <td className="py-1">{new Date(cuota.dueDate + 'T00:00:00').toLocaleDateString('es-DO')}</td>
                    <td className="py-1 text-right">{formatCurrency(cuota.amount)}</td>
                    <td className="py-1 text-right">{formatCurrency(cuota.paidAmount)}</td>
                    <td className={vencida ? 'py-1 text-right font-semibold' : 'py-1 text-right'}>
                      {vencida ? 'Vencida' : ESTADO_CUOTA[cuota.status] ?? 'Pendiente'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <Separator className="my-2" />
      <p className="text-xs font-semibold uppercase">Pagos realizados</p>
      {abonos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aún no hay pagos registrados.</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-dashed border-foreground/50 text-left">
              <th className="py-1 font-semibold">Fecha</th>
              <th className="py-1 font-semibold">Método</th>
              <th className="py-1 font-semibold text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {abonos.map((p) => (
              <tr key={p.id} className="border-b border-dotted border-foreground/20">
                <td className="py-1">
                  {p.date.toLocaleDateString('es-DO')}
                  {p.kind === 'down_payment' && ' (inicial)'}
                </td>
                <td className="py-1">{METODO[p.method]}</td>
                <td className="py-1 text-right">
                  {formatCurrency(p.amount)}
                  {p.lateFeePaid > 0 && (
                    <span className="block text-[10px] text-muted-foreground">mora {formatCurrency(p.lateFeePaid)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {profile.receiptFooter && (
        <p className="text-xs text-center text-muted-foreground pt-4">{profile.receiptFooter}</p>
      )}
    </div>
  );
}
