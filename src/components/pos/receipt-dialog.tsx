'use client';

import { useRef, useState, useEffect } from 'react';
import type { Sale } from '@/lib/types';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CalendarClock, ArrowLeft } from 'lucide-react';
import { ReceiptBarcode, ReceiptContent, ReceiptEcf, ReceiptHeader, ReceiptItems, ReceiptTotals } from './receipt-content';
import { IncluirDatosCliente } from './incluir-datos-cliente';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import {
  BotonEnviarCorreo,
  BotonesDocumento,
  DESCRIPCION_CORREO,
  PanelCorreo,
  PanelWhatsApp,
  PREGUNTA_WHATSAPP,
} from '@/components/sharing/compartir-documento';
import { useCompartirDocumento } from '@/hooks/use-compartir-documento';
import { esperarQrEcf } from '@/lib/ecf';

interface ReceiptDialogProps {
  sale: Sale | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Lo que el cajero marcó al cobrar; aquí se puede volver a cambiar. */
  incluirDatosClienteInicial?: boolean;
}

type ActiveScreen = 'receipt' | 'email_confirm' | 'whatsapp_confirm';

export function ReceiptDialog(props: ReceiptDialogProps) {
  // Los hooks de compartir necesitan la venta: sin venta no hay diálogo.
  if (!props.sale) return null;
  return <ReceiptDialogDeVenta {...props} sale={props.sale} />;
}

function ReceiptDialogDeVenta({
  sale,
  isOpen,
  onOpenChange,
  incluirDatosClienteInicial = false,
}: ReceiptDialogProps & { sale: Sale }) {
  const printRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);

  const [isPlanOpen, setPlanOpen] = useState(false);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('receipt');
  const [incluirDatosCliente, setIncluirDatosCliente] = useState(incluirDatosClienteInicial);
  const compartir = useCompartirDocumento({ sale, documento: 'factura', pdfRef: pdfContentRef });

  // Cada vez que se abre: de vuelta al recibo y con lo que se marcó al cobrar.
  useEffect(() => {
    if (isOpen) {
      setActiveScreen('receipt');
      setIncluirDatosCliente(incluirDatosClienteInicial);
    }
  }, [isOpen, sale.id, incluirDatosClienteInicial]);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    // El QR del e-CF se dibuja después de abrir el recibo: imprimir enseguida
    // lo dejaba fuera del ticket.
    onBeforeGetContent: () => esperarQrEcf(printRef.current),
  });

  return (
    <>
    <Dialog open={isOpen && !isPlanOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md flex flex-col h-[90vh] p-0 [&>button]:hidden">
        {activeScreen === 'receipt' && (
          <>
            {/* Todo el recibo se desplaza junto; solo los botones quedan fijos
                abajo. Antes solo la lista de artículos tenía scroll: con logo,
                datos del cliente y los totales de un financiamiento, lo fijo no
                cabía en el 90 % de la pantalla, la lista quedaba en alto 0 (no se
                veían los artículos) y totales y botones se salían por debajo de
                la ventana, sin poder alcanzar "Cerrar". */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DialogHeader className="p-6 pb-2">
                  {/* Radix exige un título; el recibo ya lleva su encabezado. */}
                  <DialogTitle className="sr-only">Recibo de la venta</DialogTitle>
                  <ReceiptHeader sale={sale} showCustomerInfo={incluirDatosCliente} />
              </DialogHeader>

              <div className="px-6">
                  <ReceiptItems sale={sale} />
              </div>

              <div className="px-6 pb-6 border-t pt-4 mt-2">
                <ReceiptTotals sale={sale} />
                <IncluirDatosCliente
                  className="mt-4"
                  customer={sale.customer}
                  checked={incluirDatosCliente}
                  onCheckedChange={setIncluirDatosCliente}
                />
              </div>
            </div>

            <DialogFooter className="shrink-0 flex-col gap-2 p-4 border-t bg-secondary/50 sm:flex-col sm:space-x-0">
              {/* Misma botonera que el detalle de la venta y los documentos
                  del financiamiento; WhatsApp y Correo abren las pantallas de
                  este mismo diálogo. */}
              <BotonesDocumento
                onImprimir={handlePrint}
                onWhatsApp={() => setActiveScreen('whatsapp_confirm')}
                onCorreo={() => setActiveScreen('email_confirm')}
                onPdf={compartir.descargarPdf}
              />
              <div className="flex items-center gap-2">
                {sale.paymentMethod === 'financing' && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setPlanOpen(true)}>
                    <CalendarClock className="mr-1.5 h-4 w-4" />
                    Plan de pagos
                  </Button>
                )}
                <Button size="sm" onClick={() => onOpenChange(false)} className="flex-1">
                  Cerrar
                </Button>
              </div>
            </DialogFooter>
          </>
        )}

        {activeScreen === 'email_confirm' && (
          <div className="flex flex-col h-full p-6 justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setActiveScreen('receipt')} className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle>Enviar por Correo</DialogTitle>
              </div>
              <DialogDescription>{DESCRIPCION_CORREO.factura}</DialogDescription>
              <div className="pt-2">
                <PanelCorreo c={compartir} />
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t mt-auto">
              <Button variant="outline" onClick={() => setActiveScreen('receipt')} className="flex-1" disabled={compartir.enviandoCorreo}>
                Volver
              </Button>
              <BotonEnviarCorreo c={compartir} className="flex-1" onEnviado={() => setActiveScreen('receipt')} />
            </div>
          </div>
        )}

        {activeScreen === 'whatsapp_confirm' && (
          <div className="flex flex-col h-full p-6 justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setActiveScreen('receipt')} className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle>Compartir por WhatsApp</DialogTitle>
              </div>
              <DialogDescription>{PREGUNTA_WHATSAPP.factura}</DialogDescription>
              <div className="pt-4">
                <PanelWhatsApp c={compartir} />
              </div>
            </div>

            <Button variant="outline" onClick={() => setActiveScreen('receipt')} className="w-full mt-8">
              Volver al Recibo
            </Button>
          </div>
        )}

        {/* Elemento fuera de pantalla del que se saca el PDF: sin barras de
            desplazamiento ni botones.

            Va a 100 mm de ancho porque el recibo está diseñado como ticket
            (globals.css lo imprime a 76 mm), no como hoja A4. Antes era un A4
            con `scale-[1.3] transform-origin-top-left`, y esa clase no existe
            en Tailwind — la buena es `origin-top-left`. Al no aplicar el
            origen, el scale crecía desde el centro y html2canvas recortaba lo
            que sobresalía: el PDF salía sin el principio de cada línea ni el
            final de los totales. */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
          <div ref={pdfContentRef} className="bg-white text-black w-[100mm] p-4 space-y-4">
            <ReceiptHeader sale={sale} showCustomerInfo={incluirDatosCliente} />
            <ReceiptItems sale={sale} />
            <div className="border-t pt-3">
              <ReceiptTotals sale={sale} />
            </div>
            <ReceiptEcf sale={sale} />
            <ReceiptBarcode sale={sale} className="mt-2" />
          </div>
        </div>

        {/* Hidden component for printing */}
        <div className="hidden">
            <div ref={printRef} className="receipt-container">
                <ReceiptContent sale={sale} showCustomerInfo={incluirDatosCliente} />
            </div>
        </div>
      </DialogContent>
    </Dialog>

    <PaymentPlanDialog sale={sale} isOpen={isPlanOpen} onOpenChange={setPlanOpen} />
    </>
  );
}
