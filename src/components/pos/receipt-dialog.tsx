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
import { Printer, CalendarClock, MessageSquare, Mail, ArrowLeft, Loader2, Download, Send, Copy, Link as LinkIcon } from 'lucide-react';
import { ReceiptContent, ReceiptHeader, ReceiptItems, ReceiptTotals } from './receipt-content';
import { PaymentPlanDialog } from '@/components/financing/payment-plan-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  shareSaleViaWhatsApp,
  shareSalePdfLinkViaWhatsApp,
  abrirPestanaParaWhatsApp,
  abrirWhatsAppConEnlace,
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
  // Enlace ya generado: se deja a la vista para copiarlo o reabrir el chat si
  // el navegador bloqueó la pestaña.
  const [enlace, setEnlace] = useState<{ url: string; diasValidez: number } | null>(null);

  // Reset screen and prefill email on open
  useEffect(() => {
    if (isOpen && sale) {
      setActiveScreen('receipt');
      setEmailAddress(sale.customer?.email || '');
      setEnlace(null);
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
    // Se abre YA, dentro del clic. Generar y subir el PDF tarda más de lo que
    // dura el permiso del navegador para abrir ventanas, así que dejarlo para
    // el final hace que la bloquee.
    const ventana = abrirPestanaParaWhatsApp();
    setSendingLink(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      const { url, diasValidez, abrioWhatsApp } = await shareSalePdfLinkViaWhatsApp(
        sale.id, pdfBase64, sale, profile.name, ventana,
      );
      setEnlace({ url, diasValidez });
      toast({
        title: abrioWhatsApp ? 'WhatsApp abierto con el mensaje listo' : 'Enlace listo',
        description: abrioWhatsApp
          ? `Revísalo y dale enviar. El enlace de descarga del PDF funciona por ${diasValidez} días.`
          : `Dale a "Abrir WhatsApp" para mandarlo. El enlace funciona por ${diasValidez} días.`,
      });
    } catch (error: any) {
      console.error(error);
      ventana?.close();
      toast({
        title: 'No se pudo generar el enlace',
        description: error?.message || 'Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSendingLink(false);
    }
  };

  const handleCopiarEnlace = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace.url);
      toast({ title: 'Enlace copiado', description: 'Ya puedes pegarlo donde lo necesites.' });
    } catch {
      toast({
        title: 'No se pudo copiar',
        description: 'Selecciona el enlace y cópialo a mano.',
        variant: 'destructive',
      });
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
                {/* whitespace-normal: el Button base trae whitespace-nowrap y
                    estas descripciones largas se salían del botón. */}
                <Button
                  variant="outline"
                  className="justify-start h-auto py-3 px-4 whitespace-normal border-emerald-200 dark:border-emerald-900"
                  disabled={sendingLink}
                  onClick={handleSharePdfLink}
                >
                  <div className="text-left">
                    <p className="font-semibold flex items-center">
                      <LinkIcon className="mr-2 h-4 w-4 shrink-0" />
                      {sendingLink ? 'Generando enlace...' : 'Enlace de descarga del PDF'}
                    </p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">
                      Abre el chat del cliente en WhatsApp con un mensaje listo que incluye el enlace
                      para descargar la factura en PDF. El enlace funciona por 15 días.
                    </p>
                  </div>
                </Button>

                {enlace && (
                  <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Enlace generado (válido por {enlace.diasValidez} días):
                    </p>
                    <p className="text-xs break-all font-mono">{enlace.url}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={handleCopiarEnlace}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Copiar enlace
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => abrirWhatsAppConEnlace(sale, enlace.url, enlace.diasValidez, profile.name)}
                      >
                        <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                        Abrir WhatsApp
                      </Button>
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="justify-start h-auto py-3 px-4 whitespace-normal"
                  onClick={async () => {
                    await handleDownloadPdf();
                    shareSaleViaWhatsApp(sale, profile.name);
                    setActiveScreen('receipt');
                  }}
                >
                  <div className="text-left">
                    <p className="font-semibold flex items-center">
                      <Download className="mr-2 h-4 w-4 shrink-0" /> Descargar PDF y abrir chat
                    </p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">
                      Descarga el PDF a este dispositivo y abre WhatsApp para que lo adjuntes tú mismo.
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
            <ReceiptHeader sale={sale} />
            <ReceiptItems sale={sale} />
            <div className="border-t pt-3">
              <ReceiptTotals sale={sale} />
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
