'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useReactToPrint } from 'react-to-print';
import { useSales } from '@/context/sales-provider';
import { useAuth } from '@/context/auth-provider';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Loader2, RefreshCw, FilePlus2, QrCode } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { ReceiptBarcode, ReceiptContent, ReceiptEcf, ReceiptHeader, ReceiptItems, ReceiptTotals } from '@/components/pos/receipt-content';
import { useToast } from '@/hooks/use-toast';
import { SalePaymentsCard } from '@/components/sales/sale-payments-card';
import { IncluirDatosCliente } from '@/components/pos/incluir-datos-cliente';
import { CompartirDocumento } from '@/components/sharing/compartir-documento';
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

  // No se guarda en la venta: al reimprimir para el chofer se vuelve a marcar.
  const [incluirDatosCliente, setIncluirDatosCliente] = useState(false);


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
            <CompartirDocumento sale={sale} documento="factura" pdfRef={pdfContentRef} />
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
