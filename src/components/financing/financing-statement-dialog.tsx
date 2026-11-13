'use client';

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Printer } from 'lucide-react';
import { CompartirDocumento } from '@/components/sharing/compartir-documento';
import { FinancingStatementContent } from './financing-statement-content';
import type { CreditPayment, Sale } from '@/lib/types';

interface FinancingStatementDialogProps {
  sale: Sale;
  payments: CreditPayment[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/** Estado del financiamiento: se ve, se imprime y se manda al cliente por
 *  WhatsApp o correo, o se descarga en PDF. */
export function FinancingStatementDialog({ sale, payments, isOpen, onOpenChange }: FinancingStatementDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm flex flex-col max-h-[90vh] [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="sr-only">Estado del Financiamiento</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-grow pr-3">
          <FinancingStatementContent sale={sale} payments={payments} />
        </ScrollArea>
        <DialogFooter className="flex-row flex-wrap gap-2 pt-4 border-t sm:justify-start">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-1.5 h-4 w-4" />
            Imprimir
          </Button>
          <CompartirDocumento sale={sale} documento="estado" pdfRef={pdfRef} />
          <Button size="sm" className="ml-auto" onClick={() => onOpenChange(false)}>Atrás</Button>
        </DialogFooter>

        {/* Copia oculta para impresión */}
        <div className="hidden">
          <div ref={printRef} className="receipt-container">
            <FinancingStatementContent sale={sale} payments={payments} />
          </div>
        </div>

        {/* Copia fuera de pantalla, a 100 mm como el ticket, de la que sale el
            PDF (ver la nota en receipt-dialog). */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
          <div ref={pdfRef} className="bg-white text-black w-[100mm] p-4">
            <FinancingStatementContent sale={sale} payments={payments} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
