'use client';

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Printer } from 'lucide-react';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { formatCurrency } from '@/lib/utils';
import type { Loan } from '@/lib/types';

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

// Ticket/contrato del préstamo: datos del cliente, términos y el cronograma
// completo de cuotas. Imprimible en papel térmico (misma clase que el recibo).
function TicketBody({ loan }: { loan: Loan }) {
  // Perfil de la sucursal del préstamo (branchId es UUID), con herencia de la empresa.
  const profile = useTicketProfile(loan.branchId);
  const interest = loan.totalWithInterest - loan.principal;

  return (
    <div className="text-left space-y-1">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 60, maxWidth: '80%', objectFit: 'contain' }} />
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
        <p className="font-semibold uppercase">Comprobante de Préstamo</p>
        <p className="uppercase">Fecha: {loan.createdAt.toLocaleString('es-DO')}</p>
        <p className="uppercase">No.: {loan.id.slice(0, 8)}</p>
        {loan.userName && <p className="uppercase">Le atendió: {loan.userName}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-xs pt-1">
        <p className="font-semibold uppercase">Cliente: {loan.customer?.name ?? '—'}</p>
        {loan.customer?.phone && <p className="uppercase">Tel: {loan.customer.phone}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-sm space-y-1 py-1">
        <div className="flex justify-between font-bold text-base">
          <span>Monto Prestado:</span>
          <span>{formatCurrency(loan.principal)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Interés ({loan.interestRate}% mensual):</span>
          <span>{formatCurrency(interest)}</span>
        </div>
        <div className="flex justify-between text-xs font-semibold">
          <span>Total a pagar:</span>
          <span>{formatCurrency(loan.totalWithInterest)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Plan:</span>
          <span>{loan.installmentsCount} cuotas · {FREQUENCY_LABEL[loan.paymentFrequency] ?? 'Mensual'}</span>
        </div>
      </div>
      {loan.installments && loan.installments.length > 0 && (
        <>
          <Separator className="my-2" />
          <p className="text-xs font-semibold uppercase mb-1">Cronograma de Cuotas</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal">#</th>
                <th className="text-left font-normal">Vence</th>
                <th className="text-right font-normal">Monto</th>
              </tr>
            </thead>
            <tbody>
              {loan.installments.map((c) => (
                <tr key={c.id}>
                  <td>{c.number}</td>
                  <td>{new Date(c.dueDate + 'T00:00:00').toLocaleDateString('es-DO')}</td>
                  <td className="text-right">{formatCurrency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {loan.notes && (
        <>
          <Separator className="my-2" />
          <p className="text-xs">Notas: {loan.notes}</p>
        </>
      )}
      {profile.receiptFooter && (
        <>
          <Separator className="my-2" />
          <p className="text-xs text-center text-muted-foreground">{profile.receiptFooter}</p>
        </>
      )}
      <Separator className="my-2" />
      <p className="text-xs text-center pt-6">_______________________________</p>
      <p className="text-xs text-center text-muted-foreground">Firma del cliente</p>
    </div>
  );
}

interface LoanTicketDialogProps {
  loan: Loan | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function LoanTicketDialog({ loan, isOpen, onOpenChange }: LoanTicketDialogProps) {
  const printRef = useRef(null);
  const handlePrint = useReactToPrint({ content: () => printRef.current });

  if (!loan) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Comprobante de Préstamo</DialogTitle>
        </DialogHeader>
        <TicketBody loan={loan} />
        <DialogFooter className="sm:justify-between gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>

        {/* Copia oculta para impresión térmica */}
        <div className="hidden">
          <div ref={printRef} className="receipt-container">
            <TicketBody loan={loan} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
