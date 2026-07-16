'use client';

import { Separator } from '@/components/ui/separator';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency } from '@/lib/utils';
import { addMonths } from 'date-fns';
import type { Sale } from '@/lib/types';

interface PaymentPlanContentProps {
  sale: Sale;
}

// Cronograma de cuotas imprimible. Usa las cuotas reales de la base
// (sale.installments); si aún no están cargadas, estima desde el plan.
export function PaymentPlanContent({ sale }: PaymentPlanContentProps) {
  const { profile } = useCompanyProfile();
  const fin = sale.financingDetails;

  const rows = (sale.installments && sale.installments.length > 0)
    ? sale.installments.map((i) => ({
        number: i.number,
        dueDate: new Date(i.dueDate + 'T00:00:00'),
        amount: i.amount,
        paidAmount: i.paidAmount,
        status: i.status,
      }))
    : Array.from({ length: fin?.installments ?? 0 }, (_, k) => ({
        number: k + 1,
        dueDate: addMonths(new Date(sale.createdAt), k + 1),
        amount: fin?.installmentAmount ?? 0,
        paidAmount: 0,
        status: 'pending' as const,
      }));

  return (
    <div className="text-left space-y-1">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 60, maxWidth: '80%', objectFit: 'contain' }} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-center">{profile.name}</h3>
      <div className="text-xs text-muted-foreground text-center">
        {profile.address && <p>{profile.address}</p>}
        {profile.rnc && <p>RNC: {profile.rnc}</p>}
        {profile.phone && <p>Tel: {profile.phone}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-xs pt-1 space-y-0.5">
        <p className="font-semibold uppercase">Plan de Pagos — Financiamiento</p>
        <p className="uppercase">Venta: {sale.id}</p>
        <p className="uppercase">Fecha: {new Date(sale.createdAt).toLocaleDateString('es-DO')}</p>
        <p className="uppercase">Sucursal: {sale.branchId || 'Principal'}</p>
        <p className="font-semibold uppercase">Cliente: {sale.customer?.name ?? 'Cliente Genérico'}</p>
      </div>
      <Separator className="my-2" />
      <div className="text-xs space-y-1 py-1">
        <div className="flex justify-between">
          <span>Total de la venta:</span>
          <span>{formatCurrency(sale.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Abono inicial:</span>
          <span>{formatCurrency(fin?.downPayment ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tasa de interés mensual:</span>
          <span>{fin?.interestRate ?? 0}%</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total a pagar (con intereses):</span>
          <span>{formatCurrency(fin?.totalWithInterest ?? sale.total)}</span>
        </div>
        <div className="flex justify-between">
          <span>Cantidad de cuotas:</span>
          <span>{rows.length}</span>
        </div>
      </div>
      <Separator className="my-2" />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-dashed border-foreground/50 text-left">
            <th className="py-1 font-semibold">No.</th>
            <th className="py-1 font-semibold">Vence</th>
            <th className="py-1 font-semibold text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cuota) => (
            <tr key={cuota.number} className="border-b border-dotted border-foreground/20">
              <td className="py-1">{cuota.number}</td>
              <td className="py-1">{cuota.dueDate.toLocaleDateString('es-DO')}</td>
              <td className="py-1 text-right">
                {formatCurrency(cuota.amount)}
                {cuota.status === 'paid' && ' ✓'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pt-10 grid grid-cols-2 gap-6 text-xs text-center">
        <div>
          <div className="border-t border-foreground/60 pt-1">Firma del Cliente</div>
        </div>
        <div>
          <div className="border-t border-foreground/60 pt-1">Por {profile.name}</div>
        </div>
      </div>
      {profile.receiptFooter && (
        <p className="text-xs text-center text-muted-foreground pt-4">{profile.receiptFooter}</p>
      )}
    </div>
  );
}
