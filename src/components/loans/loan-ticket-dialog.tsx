'use client';

import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Printer, MessageSquare, Mail, Download, ArrowLeft, Loader2, Send, Copy, Link as LinkIcon,
} from 'lucide-react';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';
import {
  compartirPdfPorWhatsApp,
  abrirPestanaParaWhatsApp,
  abrirWhatsAppConEnlace,
  generateReceiptPdf,
  downloadReceiptPdfFile,
  sendLoanReceiptViaResendEmail,
} from '@/lib/receipt-sharing';
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
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 85, maxWidth: '80%', objectFit: 'contain' }} />
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
          <span>Entregado en:</span>
          <span>
            {loan.disbursementMethod === 'transfer' ? 'Transferencia' : 'Efectivo'}
            {loan.disbursementReference ? ` (${loan.disbursementReference})` : ''}
          </span>
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

type ActiveScreen = 'ticket' | 'email_confirm' | 'whatsapp_confirm';

export function LoanTicketDialog({ loan, isOpen, onOpenChange }: LoanTicketDialogProps) {
  const printRef = useRef(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  const { profile } = useCompanyProfile();
  const { toast } = useToast();
  const handlePrint = useReactToPrint({ content: () => printRef.current });

  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('ticket');
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  // Enlace ya generado: se deja a la vista para copiarlo o reabrir el chat si
  // el navegador bloqueó la pestaña.
  const [enlace, setEnlace] = useState<{ url: string; diasValidez: number } | null>(null);

  useEffect(() => {
    if (isOpen && loan) {
      setActiveScreen('ticket');
      setEmailAddress(loan.customer?.email || '');
      setEnlace(null);
    }
  }, [isOpen, loan]);

  if (!loan) return null;

  const filename = `comprobante_prestamo_${loan.id.slice(0, 8)}.pdf`;

  const handleSharePdfLink = async () => {
    if (!pdfContentRef.current) return;
    // Se abre YA, dentro del clic: generar y subir el PDF tarda más de lo que
    // dura el permiso del navegador para abrir ventanas.
    const ventana = abrirPestanaParaWhatsApp();
    setSendingLink(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      const { url, diasValidez, abrioWhatsApp } = await compartirPdfPorWhatsApp({
        tipo: 'prestamo',
        id: loan.id,
        pdfBase64,
        telefono: loan.customer?.phone,
        companyName: profile.name,
        ventana,
      });
      setEnlace({ url, diasValidez });
      toast({
        title: abrioWhatsApp ? 'WhatsApp abierto con el mensaje listo' : 'Enlace listo',
        description: abrioWhatsApp
          ? `Revísalo y dale enviar. El enlace de descarga funciona por ${diasValidez} días.`
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
        description: 'Escribe una dirección de correo válida.',
        variant: 'destructive',
      });
      return;
    }
    if (!pdfContentRef.current) return;

    setIsSendingEmail(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfContentRef.current, filename);
      await sendLoanReceiptViaResendEmail(loan.id, emailAddress.trim(), pdfBase64, filename);
      toast({
        title: '¡Correo enviado!',
        description: `El comprobante se envió a ${emailAddress}.`,
      });
      setActiveScreen('ticket');
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al enviar correo',
        // El comprobante lleva el cronograma completo, así que un plan largo
        // pesa bastante más que una factura y puede pasarse del límite del
        // adjunto. El mensaje de la función trae el peso para distinguirlo.
        description: error?.message || 'No se pudo enviar el correo. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!pdfContentRef.current) return;
    try {
      await downloadReceiptPdfFile(pdfContentRef.current, filename);
      toast({ title: 'Descarga iniciada', description: 'El comprobante en PDF se descargó.' });
    } catch (error: any) {
      toast({
        title: 'Error al generar PDF',
        description: error?.message || 'No se pudo descargar el archivo.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        {activeScreen === 'ticket' && (
          <>
            <DialogHeader>
              <DialogTitle className="sr-only">Comprobante de Préstamo</DialogTitle>
            </DialogHeader>
            <TicketBody loan={loan} />
            <DialogFooter className="flex-col gap-2 pt-4 border-t sm:flex-col">
              <div className="grid grid-cols-2 gap-2 w-full">
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
                <Button variant="outline" size="sm" onClick={() => setActiveScreen('email_confirm')}>
                  <Mail className="mr-1.5 h-4 w-4" />
                  Correo
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Descargar PDF
                </Button>
              </div>
              <Button className="w-full" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </>
        )}

        {activeScreen === 'email_confirm' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setActiveScreen('ticket')} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle>Enviar por Correo</DialogTitle>
            </div>
            <DialogDescription>
              Se genera el comprobante en PDF, con el cronograma de cuotas, y se envía adjunto.
            </DialogDescription>

            <div className="space-y-2">
              <label className="text-sm font-medium">Correo del destinatario:</label>
              <Input
                type="email"
                placeholder="ejemplo@correo.com"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                disabled={isSendingEmail}
              />
              <p className="text-xs text-muted-foreground">
                {loan.customer?.email ? '✓ Correo registrado del cliente.' : '⚠ El cliente no tiene correo registrado.'}
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setActiveScreen('ticket')} className="flex-1" disabled={isSendingEmail}>
                Volver
              </Button>
              <Button onClick={handleSendEmail} className="flex-1" disabled={isSendingEmail}>
                {isSendingEmail ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando…</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" />Enviar</>
                )}
              </Button>
            </div>
          </div>
        )}

        {activeScreen === 'whatsapp_confirm' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setActiveScreen('ticket')} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle>Compartir por WhatsApp</DialogTitle>
            </div>
            <DialogDescription>
              {loan.customer?.phone
                ? `Se abrirá el chat de ${loan.customer.name ?? 'el cliente'} (${loan.customer.phone}).`
                : 'El cliente no tiene teléfono registrado: WhatsApp abrirá sin destinatario y tendrás que elegirlo.'}
            </DialogDescription>

            {/* whitespace-normal: el Button base trae whitespace-nowrap y esta
                descripción larga se saldría del botón. */}
            <Button
              variant="outline"
              className="justify-start h-auto py-3 px-4 whitespace-normal border-emerald-200 dark:border-emerald-900"
              disabled={sendingLink}
              onClick={handleSharePdfLink}
            >
              <div className="text-left">
                <p className="font-semibold flex items-center">
                  <LinkIcon className="mr-2 h-4 w-4 shrink-0" />
                  {sendingLink ? 'Generando enlace…' : 'Enlace de descarga del PDF'}
                </p>
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  Abre el chat del cliente con un mensaje listo que incluye el enlace para
                  descargar el comprobante. El enlace funciona por 15 días.
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
                    onClick={() => abrirWhatsAppConEnlace({
                      tipo: 'prestamo',
                      telefono: loan.customer?.phone,
                      url: enlace.url,
                      diasValidez: enlace.diasValidez,
                      companyName: profile.name,
                    })}
                  >
                    <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                    Abrir WhatsApp
                  </Button>
                </div>
              </div>
            )}

            <Button variant="outline" onClick={() => setActiveScreen('ticket')} className="w-full">
              Volver al comprobante
            </Button>
          </div>
        )}

        {/* Elemento fuera de pantalla del que se saca el PDF: a 100 mm porque el
            comprobante está diseñado como ticket, no como hoja A4, y en blanco
            y negro para que no se lo lleve el tema oscuro. Se monta siempre,
            también en las pantallas de confirmación: es de donde salen el PDF
            del correo y el del enlace. */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
          <div ref={pdfContentRef} className="bg-white text-black w-[100mm] p-4">
            <TicketBody loan={loan} />
          </div>
        </div>

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
