'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Loader2 } from 'lucide-react';
import { CompartirDocumento } from '@/components/sharing/compartir-documento';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditPayment } from '@/lib/supabase/mappers';
import { FinancingStatementContent } from './financing-statement-content';
import type { CreditPayment, Sale } from '@/lib/types';

interface FinancingStatementDialogProps {
  sale: Sale;
  /** Los abonos que ya tiene cargados quien abre el diálogo. Sin ellos (p. ej.
   *  desde Movimientos) el diálogo los pide al abrirse. */
  payments?: CreditPayment[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/** Estado del financiamiento: se ve, se imprime y se manda al cliente por
 *  WhatsApp o correo, o se descarga en PDF. */
export function FinancingStatementDialog({ sale, payments, isOpen, onOpenChange }: FinancingStatementDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [cargados, setCargados] = useState<CreditPayment[] | null>(null);
  const [errorAlCargar, setErrorAlCargar] = useState(false);

  // Solo si no los trajeron. Se piden de nuevo en cada apertura: entre una y
  // otra pudo entrar un abono.
  useEffect(() => {
    if (payments || !isOpen) return;
    let cancelado = false;
    setCargados(null);
    setErrorAlCargar(false);
    (async () => {
      const { data, error } = await supabase
        .from('credit_payments')
        .select('*, branches(name)')
        .eq('sale_id', sale.id)
        .order('date', { ascending: false });
      if (cancelado) return;
      if (error) setErrorAlCargar(true);
      else setCargados(data ? data.map(rowToCreditPayment) : []);
    })();
    return () => { cancelado = true; };
  }, [payments, isOpen, sale.id]);

  const abonos = payments ?? cargados;

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
          {/* Sin los abonos el estado diría que el cliente no ha pagado nada:
              no se muestra (ni se deja mandar) hasta tenerlos. */}
          {abonos ? (
            <FinancingStatementContent sale={sale} payments={abonos} />
          ) : errorAlCargar ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No se pudieron cargar los pagos de este financiamiento. Cierra y vuelve a intentarlo.
            </p>
          ) : (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </ScrollArea>
        <DialogFooter className="flex-col gap-2 pt-4 border-t sm:flex-col sm:space-x-0">
          <CompartirDocumento
            sale={sale}
            documento="estado"
            pdfRef={pdfRef}
            onImprimir={handlePrint}
            disabled={!abonos}
          />
          <Button size="sm" className="w-full" onClick={() => onOpenChange(false)}>Atrás</Button>
        </DialogFooter>

        {abonos && (
          <>
            {/* Copia oculta para impresión */}
            <div className="hidden">
              <div ref={printRef} className="receipt-container">
                <FinancingStatementContent sale={sale} payments={abonos} />
              </div>
            </div>

            {/* Copia fuera de pantalla, a 100 mm como el ticket, de la que sale el
                PDF (ver la nota en receipt-dialog). */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
              <div ref={pdfRef} className="bg-white text-black w-[100mm] p-4">
                <FinancingStatementContent sale={sale} payments={abonos} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
