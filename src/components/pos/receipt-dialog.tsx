'use client';

import { useRef, useState } from 'react';
import type { Sale } from '@/lib/types';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, CalendarClock } from 'lucide-react';
import { ReceiptContent, ReceiptHeader, ReceiptItems, ReceiptTotals } from './receipt-content';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ReceiptDialogProps {
  sale: Sale | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function ReceiptDialog({ sale, isOpen, onOpenChange }: ReceiptDialogProps) {
  const printRef = useRef(null);
  const [isPlanOpen, setPlanOpen] = useState(false);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  if (!sale) return null;

  return (
    <>
    <Dialog open={isOpen && !isPlanOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm flex flex-col h-[90vh] p-0 [&>button]:hidden">
        <DialogHeader className="p-6 pb-2">
            <ReceiptHeader sale={sale} />
        </DialogHeader>

        <ScrollArea className="flex-grow px-6">
            <ReceiptItems sale={sale} />
        </ScrollArea>

        <div className="px-6 pb-6 border-t pt-4">
          <ReceiptTotals sale={sale} />
        </div>

        <DialogFooter className="sm:justify-between gap-2 p-6 pt-4 border-t bg-secondary/50">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            {sale.paymentMethod === 'financing' && (
              <Button variant="outline" onClick={() => setPlanOpen(true)}>
                <CalendarClock className="mr-2 h-4 w-4" />
                Plan de Pagos
              </Button>
            )}
          </div>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>

        {/* Hidden component for printing */}
        <div className="hidden">
            <div ref={printRef} className="receipt-container">
                <ReceiptContent sale={sale} />
            </div>
        </div>
      </DialogContent>
    </Dialog>

    <PaymentPlanDialog sale={sale} isOpen={isPlanOpen} onOpenChange={setPlanOpen} />
    </>
  );
}
