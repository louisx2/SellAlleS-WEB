'use client';

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Printer } from 'lucide-react';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency } from '@/lib/utils';
import type { PaymentMethod, PaymentResult } from '@/lib/types';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

// Datos del abono recién registrado (PaymentResult de la RPC + contexto del
// diálogo que lo registró) para mostrar/imprimir el recibo.
export interface PaymentReceiptData {
  result: PaymentResult;
  customerName: string;
  method: PaymentMethod;
  date: Date;
  branchName: string;
  userName?: string;
  notes?: string;
  saleId?: string; // presente cuando el abono fue a una venta específica
}

function ReceiptBody({ data }: { data: PaymentReceiptData }) {
  const { profile } = useCompanyProfile();
  const { result } = data;
  const isFinancing = result.installmentsTotal != null && result.installmentsTotal > 0;

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
        <p className="font-semibold uppercase">Recibo de Abono</p>
        <p className="uppercase">Fecha: {data.date.toLocaleString('es-DO')}</p>
        <p className="uppercase">Sucursal: {data.branchName}</p>
        {data.userName && <p className="uppercase">Le atendió: {data.userName}</p>}
        {data.saleId && <p className="uppercase">Venta: {data.saleId}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-xs pt-1">
        <p className="font-semibold uppercase">Cliente: {data.customerName}</p>
        <p className="uppercase">Método de pago: {METHOD_LABEL[data.method]}</p>
        {data.notes && <p>Notas: {data.notes}</p>}
      </div>
      <Separator className="my-2" />
      <div className="text-sm space-y-1 py-1">
        <div className="flex justify-between font-bold text-base">
          <span>Monto Recibido:</span>
          <span>{formatCurrency(result.amount)}</span>
        </div>
        {result.lateFeePaid > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span>Mora cobrada:</span>
              <span>{formatCurrency(result.lateFeePaid)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Abono a capital:</span>
              <span>{formatCurrency(result.principalPaid)}</span>
            </div>
          </>
        )}
      </div>
      <Separator className="my-2" />
      <div className="text-xs space-y-1 py-1">
        <div className="flex justify-between font-semibold">
          <span>{data.saleId ? 'Saldo restante de la venta:' : 'Deuda restante del cliente:'}</span>
          <span>{formatCurrency(result.remainingBalance)}</span>
        </div>
        {isFinancing && (
          <div className="flex justify-between">
            <span>Cuotas pagadas:</span>
            <span>{result.installmentsPaid} de {result.installmentsTotal}</span>
          </div>
        )}
        {result.customerBalance != null && data.saleId && (
          <div className="flex justify-between">
            <span>Deuda total del cliente:</span>
            <span>{formatCurrency(result.customerBalance)}</span>
          </div>
        )}
      </div>
      {profile.receiptFooter && (
        <>
          <Separator className="my-2" />
          <p className="text-xs text-center text-muted-foreground">{profile.receiptFooter}</p>
        </>
      )}
    </div>
  );
}

interface PaymentReceiptDialogProps {
  data: PaymentReceiptData | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function PaymentReceiptDialog({ data, isOpen, onOpenChange }: PaymentReceiptDialogProps) {
  const printRef = useRef(null);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  if (!data) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="sr-only">Recibo de Abono</DialogTitle>
        </DialogHeader>
        <ReceiptBody data={data} />
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
            <ReceiptBody data={data} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
