'use client';

import { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useReactToPrint } from 'react-to-print';
import { useSales } from '@/context/sales-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Printer, ArrowLeft, MessageSquare, Mail, Loader2, Send, Download, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { ReceiptContent, ReceiptHeader, ReceiptItems, ReceiptTotals } from '@/components/pos/receipt-content';
import {
  shareSaleViaWhatsApp,
  shareSalePdfLinkViaWhatsApp,
  generateReceiptPdf,
  downloadReceiptPdfFile,
  sendReceiptViaResendEmail
} from '@/lib/receipt-sharing';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function SaleReceiptClient() {
  const searchParams = useSearchParams();
  const saleId = searchParams.get('id') ?? '';
  const { sales } = useSales();
  const sale = sales.find(s => s.id === saleId);
  const receiptRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  
  const { toast } = useToast();
  const { profile } = useCompanyProfile();

  const [activeDialog, setActiveDialog] = useState<'none' | 'email' | 'whatsapp'>('none');
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);

  useEffect(() => {
    if (sale) {
      setEmailAddress(sale.customer?.email || '');
    }
  }, [sale]);

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
  });

  if (!sale) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <h1 className="text-2xl font-bold mb-4">Venta no encontrada</h1>
            <p className="text-muted-foreground mb-6">No pudimos encontrar los detalles para la venta con ID: {saleId}</p>
            <Button asChild>
                <Link href="/sales">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver al Historial de Ventas
                </Link>
            </Button>
        </div>
    );
  }

  const filename = `factura_${sale.ncf || sale.id.slice(0, 8)}.pdf`;

  // Sube el PDF y abre WhatsApp con el enlace de descarga. WhatsApp no deja
  // adjuntar archivos desde un enlace, así que sin esto el cajero tiene que
  // descargar y adjuntar a mano en cada venta.
  const handleSharePdfLink = async () => {
    if (!pdfContentRef.current) return;
    setSendingLink(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      const { diasValidez } = await shareSalePdfLinkViaWhatsApp(sale.id, pdfBase64, sale, profile.name);
      toast({
        title: 'WhatsApp abierto con el mensaje listo',
        description: `Revísalo y dale enviar. El enlace de descarga del PDF funciona por ${diasValidez} días.`,
      });
      setActiveDialog('none');
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
      
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      await sendReceiptViaResendEmail(sale.id, emailAddress.trim(), pdfBase64, filename, sale, profile.name);
      
      toast({
        title: '¡Correo enviado!',
        description: `El comprobante se envió correctamente a ${emailAddress}.`,
      });
      setActiveDialog('none');
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
    <div className="max-w-md mx-auto print:mx-0 print:max-w-full">
        <div className="mb-6 print:hidden">
            <Button asChild variant="outline">
                <Link href="/sales">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver al Historial
                </Link>
            </Button>
        </div>
      {sale.cancelledAt && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 p-3 text-center text-sm font-semibold text-destructive">
          VENTA ANULADA el {sale.cancelledAt.toLocaleDateString('es-DO')} — se emitió nota de crédito.
        </div>
      )}
      <Card className="print:shadow-none print:border-none">
        <CardHeader className="print:hidden" />
        <CardContent>
            <div ref={receiptRef} className="receipt-container">
                <ReceiptContent sale={sale} />
            </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="mr-1.5 h-4 w-4" />
                Imprimir
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
              onClick={() => setActiveDialog('whatsapp')}
            >
              <MessageSquare className="mr-1.5 h-4 w-4" />
              WhatsApp
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveDialog('email')}
            >
              <Mail className="mr-1.5 h-4 w-4" />
              Correo
            </Button>
        </CardFooter>
      </Card>

      {/* Email Sender Dialog */}
      <Dialog open={activeDialog === 'email'} onOpenChange={(open) => !open && setActiveDialog('none')}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4">
            <DialogTitle>Enviar por Correo</DialogTitle>
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
          <DialogFooter className="flex-row gap-2 pt-4">
            <Button variant="outline" onClick={() => setActiveDialog('none')} className="flex-1" disabled={isSendingEmail}>
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
                  Enviar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Dialog */}
      <Dialog open={activeDialog === 'whatsapp'} onOpenChange={(open) => !open && setActiveDialog('none')}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4">
            <DialogTitle>Compartir por WhatsApp</DialogTitle>
            <DialogDescription>
              ¿Cómo deseas compartir el comprobante de esta venta?
            </DialogDescription>
            <div className="flex flex-col gap-3 pt-2">
              {/* whitespace-normal: el Button base trae whitespace-nowrap y
                  estas descripciones largas se salían del botón. */}
              <Button
                variant="outline"
                className="justify-start h-auto py-3 px-4 whitespace-normal border-emerald-200 dark:border-emerald-900 bg-emerald-50/10 hover:bg-emerald-50/20"
                onClick={() => {
                  shareSaleViaWhatsApp(sale, profile.name);
                  setActiveDialog('none');
                }}
              >
                <div className="text-left">
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
                    <MessageSquare className="mr-2 h-4 w-4 shrink-0" /> Texto detallado
                  </p>
                  <p className="text-xs text-muted-foreground font-normal mt-0.5">
                    Abre el chat del cliente en WhatsApp con la lista de productos y totales ya escrita. Tú solo le das enviar.
                  </p>
                </div>
              </Button>

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

              <Button
                variant="outline"
                className="justify-start h-auto py-3 px-4 whitespace-normal"
                onClick={async () => {
                  await handleDownloadPdf();
                  shareSaleViaWhatsApp(sale, profile.name);
                  setActiveDialog('none');
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
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setActiveDialog('none')} className="w-full">
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
