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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Printer } from 'lucide-react';
import { useSales } from '@/context/sales-provider';
import { PaymentPlanContent } from './payment-plan-content';
import type { Sale } from '@/lib/types';

interface PaymentPlanDialogProps {
  sale: Sale | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function PaymentPlanDialog({ sale, isOpen, onOpenChange }: PaymentPlanDialogProps) {
  const { sales } = useSales();
  const printRef = useRef(null);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  if (!sale) return null;

  // Versión fresca del provider: trae las cuotas reales generadas por la base
  // (la venta recién guardada del checkout aún no las incluye).
  const freshSale = sales.find((s) => s.id === sale.id) ?? sale;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm flex flex-col max-h-[90vh] [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="sr-only">Plan de Pagos</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-grow pr-3">
          <PaymentPlanContent sale={freshSale} />
        </ScrollArea>
        <DialogFooter className="sm:justify-between gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button onClick={() => onOpenChange(false)}>Atrás</Button>
        </DialogFooter>

        {/* Copia oculta para impresión */}
        <div className="hidden">
          <div ref={printRef} className="receipt-container">
            <PaymentPlanContent sale={freshSale} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
