'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useReactToPrint } from 'react-to-print';
import { useSales } from '@/context/sales-provider';
import { useAuth } from '@/context/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Printer, ArrowLeft, MessageSquare, Mail, Loader2, Send, Download, Copy, Link as LinkIcon, RefreshCw, FilePlus2, QrCode } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { ReceiptBarcode, ReceiptContent, ReceiptEcf, ReceiptHeader, ReceiptItems, ReceiptTotals } from '@/components/pos/receipt-content';
import {
  shareSalePdfLinkViaWhatsApp,
  abrirPestanaParaWhatsApp,
  abrirWhatsAppConEnlace,
  generateReceiptPdf,
  downloadReceiptPdfFile,
  sendReceiptViaResendEmail
} from '@/lib/receipt-sharing';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SalePaymentsCard } from '@/components/sales/sale-payments-card';
import { IncluirDatosCliente } from '@/components/pos/incluir-datos-cliente';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EcfEstadoBadge } from '@/components/ecf/ecf-estado-badge';
import { avisarCambioDeEcf } from '@/components/ecf/ecf-problemas-banner';
import { supabase } from '@/lib/supabase/client';
import { rowToEcfDocumento } from '@/lib/supabase/mappers';
import { emitirEcf } from '@/lib/ecf-client';
import { cuentaComoProblemaEcf, ecfConProblema, esEcf, esperarQrEcf, puedeReemitir, puedeReintentar, resultadoDeEcf } from '@/lib/ecf';
import type { ResultadoEcf } from '@/lib/ecf';
import { cn } from '@/lib/utils';
import type { EcfDocumento, EcfEstado } from '@/lib/types';

// Todo el documento menos `request_json` (la copia de lo enviado, solo para soporte).
const ECF_COLUMNAS = 'id, tipo_ecf, encf, estado, security_code, qr_url, signed_at, mensajes_dgii, reemplazado_por, created_at';

// Qué pasa con un comprobante que no salió bien, para quien lo ve en el detalle.
const PISTA_ECF: Partial<Record<EcfEstado, string>> = {
  rechazado: 'La DGII rechazó este comprobante. Hay que reemitirlo: saldrá con un e-NCF nuevo.',
  error_datos: 'No se pudo armar el comprobante con los datos de la venta. Cuando se corrija, se reintenta el envío.',
  sin_cupo: 'No había cupo para enviarlo. Se puede reintentar cuando el plan lo permita.',
};

type AccionEcf = 'reintentar' | 'reemitir' | 'reimprimir';

const TITULO_ACCION_ECF: Record<AccionEcf, string> = {
  reintentar: 'Reintento enviado',
  reemitir: 'Comprobante reemitido',
  reimprimir: 'Comprobante actualizado',
};

// Lo que se le dice a quien pulsó la acción, según cómo quedó el comprobante.
// 'con_problemas' tiene su propio aviso (destructivo) y no pasa por aquí.
const DESCRIPCION_RESULTADO_ECF: Record<Exclude<ResultadoEcf, 'con_problemas'>, string> = {
  listo: 'Ya tiene su código QR: puedes imprimirlo.',
  en_proceso: 'Aún no tiene código QR. Se sigue enviando a la DGII; vuelve a revisar en unos minutos.',
  desconocido: 'Revisa el estado del comprobante en esta pantalla.',
};

export default function SaleReceiptClient() {
  const searchParams = useSearchParams();
  const saleId = searchParams.get('id') ?? '';
  const { sales, reload } = useSales();
  const { appUser } = useAuth();
  const baseSale = sales.find(s => s.id === saleId);
  const receiptRef = useRef<HTMLDivElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  
  const { toast } = useToast();
  const { profile } = useCompanyProfile();

  const [activeDialog, setActiveDialog] = useState<'none' | 'email' | 'whatsapp'>('none');
  const [emailAddress, setEmailAddress] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  // Enlace ya generado: se deja a la vista para copiarlo o reabrir el chat si
  // el navegador bloqueó la pestaña.
  const [enlace, setEnlace] = useState<{ url: string; diasValidez: number } | null>(null);
  // No se guarda en la venta: al reimprimir para el chofer se vuelve a marcar.
  const [incluirDatosCliente, setIncluirDatosCliente] = useState(false);

  useEffect(() => {
    if (baseSale) {
      setEmailAddress(baseSale.customer?.email || '');
    }
  }, [baseSale]);

  // El e-CF vigente se lee fresco al abrir y tras cada acción: el que viene con
  // la lista de ventas puede tener minutos. La lista se pone al día al recargar.
  const [ecfFresco, setEcfFresco] = useState<EcfDocumento | undefined>(undefined);
  const [accionEcf, setAccionEcf] = useState<AccionEcf | null>(null);
  const [confirmarReemision, setConfirmarReemision] = useState(false);
  const esVentaEcf = esEcf(baseSale?.ncf);

  const cargarEcf = useCallback(async (): Promise<EcfDocumento | undefined> => {
    const { data, error } = await supabase
      .from('ecf_documentos')
      .select(ECF_COLUMNAS)
      .eq('sale_id', saleId)
      .is('reemplazado_por', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Si la consulta falla se sigue con el de la lista: no se borra el estado.
    return !error && data ? rowToEcfDocumento(data) : undefined;
  }, [saleId]);

  useEffect(() => {
    setEcfFresco(undefined);
    if (!esVentaEcf) return;
    let cancelado = false;
    cargarEcf().then((doc) => { if (!cancelado) setEcfFresco(doc); });
    return () => { cancelado = true; };
  }, [esVentaEcf, cargarEcf]);

  // La venta con el comprobante al día: de aquí salen el recibo, el PDF y el panel.
  const sale = useMemo(
    () => (baseSale ? { ...baseSale, ecf: ecfFresco ?? baseSale.ecf } : undefined),
    [baseSale, ecfFresco],
  );

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    // El QR del e-CF se dibuja después de montar el recibo: imprimir enseguida
    // lo dejaba fuera del ticket.
    onBeforeGetContent: () => esperarQrEcf(receiptRef.current),
  });

  if (!sale) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <h1 className="text-2xl font-bold mb-4">Venta no encontrada</h1>
            <p className="text-muted-foreground mb-6">No pudimos encontrar los detalles para la venta con ID: {saleId}</p>
            <Button asChild>
                <Link href="/sales">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a Movimientos
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

  // Reintentar, Reemitir y Reimprimir terminan igual: se le pide al servidor que
  // firme y envíe lo que quedó por enviar, se lee el comprobante como quedó y se
  // avisa al aviso del menú, que cuenta los comprobantes con problemas.
  const ejecutarAccionEcf = async (accion: AccionEcf) => {
    if (!sale.ecf) return;
    setAccionEcf(accion);
    try {
      if (accion === 'reintentar') {
        const { error } = await supabase.rpc('ecf_reintentar', { p_documento: sale.ecf.id });
        if (error) throw error;
      } else if (accion === 'reemitir') {
        const { error } = await supabase.rpc('reemitir_ecf', { p_sale_id: sale.id });
        if (error) throw error;
        // La venta tiene ahora otro e-NCF: se suelta el documento anterior (el
        // rechazado) para no verlo junto al número nuevo, y se recarga para que
        // el recibo lo muestre.
        setEcfFresco(undefined);
        await reload();
      }
      // null = no respondió a tiempo; el servidor sigue y lo reintenta solo.
      await emitirEcf({ saleId: sale.id });
      const nuevo = await cargarEcf();
      if (nuevo) setEcfFresco(nuevo);
      avisarCambioDeEcf();
      // Lo que se dice depende de cómo quedó, no de que la acción haya corrido:
      // un comprobante que vuelve a fallar no se "sigue enviando", nadie lo reintenta solo.
      const resultado = resultadoDeEcf(nuevo);
      if (resultado === 'con_problemas') {
        toast({
          title: 'Comprobante con problemas',
          description: 'Sigue con problemas: revisa el estado y los mensajes de la DGII.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: TITULO_ACCION_ECF[accion],
          description: DESCRIPCION_RESULTADO_ECF[resultado],
        });
      }
    } catch (error: any) {
      toast({
        title: `No se pudo ${accion}`,
        description: error?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setAccionEcf(null);
    }
  };

  const ecf = sale.ecf;
  // Reintentar y Reemitir los resuelve el administrador (la base lo exige).
  // Siguen en modo solo facturación: sin eso la factura no sale. Reimprimir
  // solo trae los datos que faltan.
  const puedeAdministrarEcf = !!appUser?.isCompanyAdmin;
  const verReintentar = puedeAdministrarEcf && !!ecf && puedeReintentar(ecf);
  // Una venta anulada ya no se reemite: la base lo rechaza.
  const verReemitir = puedeAdministrarEcf && !!ecf && puedeReemitir(ecf) && !sale.cancelledAt;
  // Reimprimir trae el QR de lo que el servidor sigue enviando. Un rechazado, con
  // error o sin cupo no avanza hasta que se reintente o se reemita, así que ahí no sirve.
  const verReimprimir = !!ecf && !ecf.qrUrl && !ecfConProblema(ecf.estado);
  // Una venta anulada con el comprobante rechazado ya no tiene nada que resolver.
  const ecfPorResolver = !!ecf && cuentaComoProblemaEcf(ecf.estado, !!sale.cancelledAt);

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
      {ecf && esEcf(sale.ncf) && (
        <div
          className={cn(
            'mb-4 rounded-md border p-3 text-sm print:hidden',
            ecfPorResolver && 'border-destructive/50 bg-destructive/5',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Estado en la DGII</p>
            <EcfEstadoBadge estado={ecf.estado} />
          </div>
          {ecfPorResolver && PISTA_ECF[ecf.estado] && (
            <p className="mt-2 text-xs text-muted-foreground">{PISTA_ECF[ecf.estado]}</p>
          )}
          {ecf.mensajesDgii.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">
              <p className="font-medium">Mensajes de la DGII</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {ecf.mensajesDgii.map((m, i) => (
                  <li key={`${m.codigo}-${i}`}>
                    <span className="font-mono">{m.codigo}</span> · {m.valor}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(verReintentar || verReemitir || verReimprimir) && (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {verReintentar && (
                <Button variant="outline" size="sm" disabled={accionEcf !== null} onClick={() => ejecutarAccionEcf('reintentar')}>
                  {accionEcf === 'reintentar'
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    : <RefreshCw className="mr-1.5 h-4 w-4" />}
                  Reintentar
                </Button>
              )}
              {verReemitir && (
                <Button variant="outline" size="sm" disabled={accionEcf !== null} onClick={() => setConfirmarReemision(true)}>
                  {accionEcf === 'reemitir'
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    : <FilePlus2 className="mr-1.5 h-4 w-4" />}
                  Reemitir
                </Button>
              )}
              {verReimprimir && (
                <Button variant="outline" size="sm" disabled={accionEcf !== null} onClick={() => ejecutarAccionEcf('reimprimir')}>
                  {accionEcf === 'reimprimir'
                    ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    : <QrCode className="mr-1.5 h-4 w-4" />}
                  Reimprimir
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <Card className="print:shadow-none print:border-none">
        <CardHeader className="print:hidden" />
        <CardContent>
            <div ref={receiptRef} className="receipt-container">
                <ReceiptContent sale={sale} showCustomerInfo={incluirDatosCliente} />
            </div>
            <IncluirDatosCliente
              className="mt-4 print:hidden"
              customer={sale.customer}
              checked={incluirDatosCliente}
              onCheckedChange={setIncluirDatosCliente}
            />
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
            {/* Vivía dentro de "Descargar PDF y abrir chat", en el diálogo de
                WhatsApp. Al quitar esa opción era la única forma de guardar el
                PDF en el dispositivo, así que sube al pie. */}
            <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
              <Download className="mr-1.5 h-4 w-4" />
              Descargar PDF
            </Button>
        </CardFooter>
      </Card>

      {/* Los abonos se buscan aquí antes que en /financing/detail o en el
          estado de cuenta, que era donde vivía el único historial. */}
      <SalePaymentsCard sale={sale} />

      {/* Reemitir gasta un e-NCF nuevo de la secuencia: se confirma antes. */}
      <AlertDialog open={confirmarReemision} onOpenChange={setConfirmarReemision}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemitir el comprobante?</AlertDialogTitle>
            <AlertDialogDescription>
              La venta recibirá un e-NCF nuevo y el comprobante rechazado por la DGII quedará
              reemplazado. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => ejecutarAccionEcf('reemitir')}>Reemitir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setActiveDialog('none')} className="w-full">
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Elemento fuera de pantalla del que se saca el PDF: sin barras de
          desplazamiento ni botones.

          Va a 100 mm de ancho porque el recibo está diseñado como ticket
          (globals.css lo imprime a 76 mm), no como hoja A4. Antes era un A4 con
          `scale-[1.3] transform-origin-top-left`, y esa clase no existe en
          Tailwind — la buena es `origin-top-left`. Al no aplicar el origen, el
          scale crecía desde el centro y html2canvas recortaba lo que
          sobresalía: el PDF salía sin el principio de cada línea ni el final de
          los totales. */}
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
    </div>
  );
}
