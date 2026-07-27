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
import { Input } from '@/components/ui/input';
import { Printer, CalendarClock, MessageSquare, Mail, ArrowLeft, Loader2, Download, Send, Link as LinkIcon } from 'lucide-react';
import { ReceiptContent, ReceiptHeader, ReceiptItems, ReceiptTotals } from './receipt-content';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  shareSaleViaWhatsApp,
  shareSalePdfLinkViaWhatsApp,
  generateReceiptPdf,
  downloadReceiptPdfFile,
  sendReceiptViaResendEmail
} from '@/lib/receipt-sharing';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';

interface ReceiptDialogProps {
  sale: Sale | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

type ActiveScreen = 'receipt' | 'email_confirm' | 'whatsapp_confirm';

export function ReceiptDialog({ sale, isOpen, onOpenChange }: ReceiptDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  
  const { toast } = useToast();
  const { profile } = useCompanyProfile();
  
  const [isPlanOpen, setPlanOpen] = useState(false);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('receipt');
  
  // Email states
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  
  // Reset screen and prefill email on open
  useEffect(() => {
    if (isOpen && sale) {
      setActiveScreen('receipt');
      setEmailAddress(sale.customer?.email || '');
    }
  }, [isOpen, sale]);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
  });

  if (!sale) return null;

  const filename = `factura_${sale.ncf || sale.id.slice(0, 8)}.pdf`;

  // Sube el PDF y abre WhatsApp con el enlace de descarga. WhatsApp no deja
  // adjuntar archivos desde un enlace, así que esta es la única forma de que el
  // cajero no tenga que descargar y adjuntar a mano.
  const handleSharePdfLink = async () => {
    if (!pdfContentRef.current) return;
    setSendingLink(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      const { diasValidez } = await shareSalePdfLinkViaWhatsApp(sale.id, pdfBase64, sale, profile.name);
      toast({
        title: 'Enlace generado',
        description: `El enlace de descarga estará disponible por ${diasValidez} días.`,
      });
      setActiveScreen('receipt');
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'No se pudo generar el enlace',
        description: error?.message || 'Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSendingLink(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailAddress.trim() || !emailAddress.includes('@')) {
      toast({
        title: 'Correo inválido',
        description: 'Por favor ingrese una dirección de correo electrónico válida.',
        variant: 'destructive',
      });
      return;
    }

    setIsSendingEmail(true);
    try {
      if (!pdfContentRef.current) {
        throw new Error('No se pudo ubicar el elemento de la factura para generar el PDF.');
      }
      
      // 1. Generate PDF in background
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      
      // 2. Call Edge Function to send email
      await sendReceiptViaResendEmail(sale.id, emailAddress.trim(), pdfBase64, filename, sale, profile.name);
      
      toast({
        title: '¡Correo enviado!',
        description: `El comprobante se envió correctamente a ${emailAddress}.`,
      });
      setActiveScreen('receipt');
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al enviar correo',
        description: error?.message || 'No se pudo enviar el correo. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      if (!pdfContentRef.current) {
        throw new Error('No se pudo ubicar el elemento de la factura.');
      }
      await downloadReceiptPdfFile(pdfContentRef.current, filename);
      toast({
        title: 'Descarga iniciada',
        description: 'La factura en PDF se ha descargado correctamente.',
      });
    } catch (error: any) {
      toast({
        title: 'Error al generar PDF',
        description: error?.message || 'No se pudo descargar el archivo PDF.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
    <Dialog open={isOpen && !isPlanOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md flex flex-col h-[90vh] p-0 [&>button]:hidden">
        {activeScreen === 'receipt' && (
          <>
            <DialogHeader className="p-6 pb-2">
                <ReceiptHeader sale={sale} />
            </DialogHeader>

            <ScrollArea className="flex-grow px-6">
                <ReceiptItems sale={sale} />
            </ScrollArea>

            <div className="px-6 pb-6 border-t pt-4">
              <ReceiptTotals sale={sale} />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 p-4 border-t bg-secondary/50">
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  Imprimir
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                  onClick={() => setActiveScreen('whatsapp_confirm')}
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveScreen('email_confirm')}
                >
                  <Mail className="mr-1.5 h-4 w-4" />
                  Correo
                </Button>
                {sale.paymentMethod === 'financing' && (
                  <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)}>
                    <CalendarClock className="mr-1.5 h-4 w-4" />
                    Plan de Pagos
                  </Button>
                )}
              </div>
              <Button size="sm" onClick={() => onOpenChange(false)} className="w-full sm:w-auto ml-auto">
                Cerrar
              </Button>
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
              <DialogDescription>
                Se generará la factura en PDF y se enviará al correo del cliente.
              </DialogDescription>
              
              <div className="space-y-2 pt-2">
                <label className="text-sm font-medium">Correo del destinatario:</label>
                <Input
                  type="email"
                  placeholder="ejemplo@correo.com"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  disabled={isSendingEmail}
                />
                {sale.customer && sale.customer.id !== '0' && (
                  <p className="text-xs text-muted-foreground">
                    {sale.customer.email ? '✓ Correo registrado del cliente.' : '⚠ El cliente no tiene correo registrado.'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t mt-auto">
              <Button variant="outline" onClick={() => setActiveScreen('receipt')} className="flex-1" disabled={isSendingEmail}>
                Volver
              </Button>
              <Button onClick={handleSendEmail} className="flex-1" disabled={isSendingEmail}>
                {isSendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Enviar Correo
                  </>
                )}
              </Button>
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
              <DialogDescription>
                ¿Cómo deseas compartir el comprobante de esta venta?
              </DialogDescription>

              <div className="flex flex-col gap-3 pt-4">
                <Button 
                  variant="outline" 
                  className="justify-start h-auto py-3 px-4 border-emerald-200 dark:border-emerald-900 bg-emerald-50/10 hover:bg-emerald-50/20"
                  onClick={() => {
                    shareSaleViaWhatsApp(sale, profile.name);
                    setActiveScreen('receipt');
                  }}
                >
                  <div className="text-left">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
                      <MessageSquare className="mr-2 h-4 w-4" /> Enviar Texto Detallado
                    </p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">
                      Abre el chat de WhatsApp con un mensaje pre-escrito de la lista de productos y totales.
                    </p>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="justify-start h-auto py-3 px-4 border-emerald-200 dark:border-emerald-900"
                  disabled={sendingLink}
                  onClick={handleSharePdfLink}
                >
                  <div className="text-left">
                    <p className="font-semibold flex items-center">
                      <LinkIcon className="mr-2 h-4 w-4" />
                      {sendingLink ? 'Generando enlace...' : 'Enviar Enlace del PDF'}
                    </p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">
                      Manda el mensaje con un enlace de descarga del PDF. No hay que adjuntar nada a mano.
                    </p>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="justify-start h-auto py-3 px-4"
                  onClick={async () => {
                    await handleDownloadPdf();
                    shareSaleViaWhatsApp(sale, profile.name);
                    setActiveScreen('receipt');
                  }}
                >
                  <div className="text-left">
                    <p className="font-semibold flex items-center">
                      <Download className="mr-2 h-4 w-4" /> Descargar PDF y Abrir Chat
                    </p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">
                      Descarga el archivo PDF de la factura al dispositivo y abre WhatsApp para que lo puedas adjuntar.
                    </p>
                  </div>
                </Button>
              </div>
            </div>

            <Button variant="outline" onClick={() => setActiveScreen('receipt')} className="w-full mt-8">
              Volver al Recibo
            </Button>
          </div>
        )}

        {/* Off-screen DOM element for clean PDF generation without scrollbars/buttons */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
          <div ref={pdfContentRef} className="bg-white text-black p-8 w-[210mm] min-h-[297mm] space-y-6">
            <div className="scale-[1.3] transform-origin-top-left p-6">
              <ReceiptHeader sale={sale} />
              <div className="my-6">
                <ReceiptItems sale={sale} />
              </div>
              <div className="border-t pt-4">
                <ReceiptTotals sale={sale} />
              </div>
            </div>
          </div>
        </div>

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
