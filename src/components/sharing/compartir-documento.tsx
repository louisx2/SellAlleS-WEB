'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Copy, Download, Link as LinkIcon, Loader2, Mail, MessageSquare, Printer, Send } from 'lucide-react';
import { useCompartirDocumento, type CompartirDocumento as Compartir } from '@/hooks/use-compartir-documento';
import { diasDeValidez, vigenciaDelEnlace, type DocumentoVenta } from '@/lib/documentos-venta';
import { cn } from '@/lib/utils';
import type { Sale } from '@/lib/types';

/** Cómo se nombra el documento dentro de una frase: "descargar <esto> en PDF". */
const EN_FRASE: Record<DocumentoVenta, string> = {
  factura: 'la factura',
  plan: 'el plan de pagos',
  estado: 'el estado del financiamiento',
};

export const PREGUNTA_WHATSAPP: Record<DocumentoVenta, string> = {
  factura: '¿Cómo deseas compartir el comprobante de esta venta?',
  plan: 'Manda el plan de pagos al cliente por WhatsApp.',
  estado: 'Manda el estado del financiamiento al cliente por WhatsApp.',
};

export const DESCRIPCION_CORREO: Record<DocumentoVenta, string> = {
  factura: 'Se generará la factura en PDF y se enviará al correo del cliente.',
  plan: 'Se generará el plan de pagos en PDF y se enviará al correo del cliente.',
  estado: 'Se generará el estado del financiamiento en PDF y se enviará al correo del cliente.',
};

/** Botón del enlace de descarga y, ya generado, el enlace para copiarlo o
 *  reabrir el chat (por si el navegador bloqueó la pestaña). */
export function PanelWhatsApp({ c }: { c: Compartir }) {
  return (
    <div className="flex flex-col gap-3">
      {/* whitespace-normal: el Button base trae whitespace-nowrap y estas
          descripciones largas se salían del botón. */}
      <Button
        variant="outline"
        className="justify-start h-auto py-3 px-4 whitespace-normal border-emerald-200 dark:border-emerald-900"
        disabled={c.enviandoEnlace}
        onClick={c.compartirWhatsApp}
      >
        <div className="text-left">
          <p className="font-semibold flex items-center">
            <LinkIcon className="mr-2 h-4 w-4 shrink-0" />
            {c.enviandoEnlace ? 'Generando enlace...' : 'Enlace de descarga del PDF'}
          </p>
          <p className="text-xs text-muted-foreground font-normal mt-0.5">
            Abre el chat del cliente en WhatsApp con un mensaje listo que incluye el enlace
            para descargar {EN_FRASE[c.documento]} en PDF. El enlace funciona por{' '}
            {diasDeValidez(c.documento, c.sale.ncf)} días.
          </p>
        </div>
      </Button>

      {c.enlace && (
        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Enlace generado (válido {vigenciaDelEnlace(c.enlace.validez)}):
          </p>
          <p className="text-xs break-all font-mono">{c.enlace.url}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={c.copiarEnlace}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copiar enlace
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={c.reabrirWhatsApp}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Abrir WhatsApp
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Campo del correo del destinatario, con el aviso de si el cliente lo tiene. */
export function PanelCorreo({ c }: { c: Compartir }) {
  const { sale } = c;
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Correo del destinatario:</label>
      <Input
        type="email"
        placeholder="ejemplo@correo.com"
        value={c.correo}
        onChange={(e) => c.setCorreo(e.target.value)}
        disabled={c.enviandoCorreo}
      />
      {sale.customer && sale.customer.id !== '0' && (
        <p className="text-xs text-muted-foreground">
          {sale.customer.email ? '✓ Correo registrado del cliente.' : '⚠ El cliente no tiene correo registrado.'}
        </p>
      )}
    </div>
  );
}

export function BotonEnviarCorreo({ c, onEnviado, className }: { c: Compartir; onEnviado?: () => void; className?: string }) {
  return (
    <Button
      onClick={async () => { if (await c.enviarCorreo()) onEnviado?.(); }}
      className={className}
      disabled={c.enviandoCorreo}
    >
      {c.enviandoCorreo ? (
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
  );
}

// Columnas de la botonera: poco relleno y poca separación (el Button trae
// gap-2), y el ícono solo desde tableta. El tamaño del ícono lo pone el Button.
const BOTON = 'w-full gap-1 px-1.5';
const ICONO = 'hidden sm:block';

interface BotonesDocumentoProps {
  /** Sin esto no sale el botón de imprimir (p. ej. mientras carga el documento). */
  onImprimir?: () => void;
  onWhatsApp: () => void;
  onCorreo: () => void;
  onPdf: () => void;
  /** Mientras el documento no está listo (cargando sus datos), nada se manda. */
  disabled?: boolean;
  className?: string;
}

/** La botonera de un documento de la venta, igual en todas partes:
 *  Imprimir · Enviar ▾ (WhatsApp, Correo) · PDF, en columnas iguales que
 *  ocupan todo el ancho.
 *
 *  Va en columnas porque casi siempre vive en algo angosto (el ticket mide
 *  ~335 px en sus diálogos): sueltos, los botones se partían en filas
 *  desparejas.
 *
 *  En el teléfono cada columna baja a ~84 px (cuadro de abonos) y el ícono ya
 *  no cabe junto al texto: ahí van solo con texto. «Enviar» conserva la flecha,
 *  que es lo que dice que despliega un menú.
 *
 *  Solo pinta los botones; quien la usa decide qué abre cada uno (diálogos en
 *  CompartirDocumento, pantallas internas en el recibo del POS). */
export function BotonesDocumento({
  onImprimir, onWhatsApp, onCorreo, onPdf, disabled, className,
}: BotonesDocumentoProps) {
  // Si la botonera vive dentro de un diálogo (recibo del POS, plan de pagos,
  // estado del financiamiento, abonos), el menú se dibuja DENTRO de ese diálogo.
  //
  // El proyecto tiene dos copias de la capa de Radix que maneja clics y foco
  // (@radix-ui/react-dismissable-layer 1.1.5 en el menú y 1.1.11 en el diálogo),
  // y no se ven entre sí. Dibujado fuera, el diálogo trataba el menú como algo
  // ajeno: le bloqueaba los clics y lo dejaba invisible ("Enviar no hace nada").
  // Con el menú modal pasaba lo contrario: al cerrar el diálogo que abre, la página
  // se quedaba sin clics. Dentro del diálogo, para él es contenido propio.
  const raizRef = useRef<HTMLDivElement>(null);
  const [contenedor, setContenedor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContenedor(raizRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);

  return (
    <div ref={raizRef} className={cn('grid w-full gap-2', onImprimir ? 'grid-cols-3' : 'grid-cols-2', className)}>
      {onImprimir && (
        <Button variant="outline" size="sm" className={BOTON} onClick={onImprimir} disabled={disabled}>
          <Printer className={ICONO} />
          Imprimir
        </Button>
      )}
      {/* modal={false}: el menú abre otro diálogo, y en modo modal la página se
          queda sin clics al cerrarlo (dos copias de la capa de Radix, ver arriba). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={BOTON}
            disabled={disabled}
            title="Enviar al cliente por WhatsApp o correo"
          >
            <Send className={ICONO} />
            Enviar
            <ChevronDown className="!size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-44" container={contenedor}>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Enviar al cliente por
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={onWhatsApp}>
            <MessageSquare className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            WhatsApp
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCorreo}>
            <Mail className="mr-2 h-4 w-4" />
            Correo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" className={BOTON} onClick={onPdf} disabled={disabled} title="Descargar en PDF">
        <Download className={ICONO} />
        PDF
      </Button>
    </div>
  );
}

interface CompartirDocumentoProps {
  sale: Sale;
  documento: DocumentoVenta;
  /** Elemento fuera de pantalla, a 100 mm, del que se saca el PDF. */
  pdfRef: RefObject<HTMLDivElement>;
  onImprimir?: () => void;
  disabled?: boolean;
  className?: string;
}

/** Botonera de un documento de la venta (ver BotonesDocumento) con sus diálogos
 *  de WhatsApp y Correo. Lo usan el detalle de la venta, el cuadro de abonos, el
 *  plan de pagos y el estado del financiamiento. */
export function CompartirDocumento({
  sale, documento, pdfRef, onImprimir, disabled, className,
}: CompartirDocumentoProps) {
  const c = useCompartirDocumento({ sale, documento, pdfRef });
  const [abierto, setAbierto] = useState<'none' | 'whatsapp' | 'correo'>('none');

  return (
    <>
      <BotonesDocumento
        onImprimir={onImprimir}
        onWhatsApp={() => setAbierto('whatsapp')}
        onCorreo={() => setAbierto('correo')}
        onPdf={c.descargarPdf}
        disabled={disabled}
        className={className}
      />

      <Dialog open={abierto === 'correo'} onOpenChange={(open) => !open && setAbierto('none')}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4">
            <DialogTitle>Enviar por Correo</DialogTitle>
            <DialogDescription>{DESCRIPCION_CORREO[documento]}</DialogDescription>
            <div className="pt-2">
              <PanelCorreo c={c} />
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 pt-4">
            <Button variant="outline" onClick={() => setAbierto('none')} className="flex-1" disabled={c.enviandoCorreo}>
              Volver
            </Button>
            <BotonEnviarCorreo c={c} className="flex-1" onEnviado={() => setAbierto('none')} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={abierto === 'whatsapp'} onOpenChange={(open) => !open && setAbierto('none')}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4">
            <DialogTitle>Compartir por WhatsApp</DialogTitle>
            <DialogDescription>{PREGUNTA_WHATSAPP[documento]}</DialogDescription>
            <div className="pt-2">
              <PanelWhatsApp c={c} />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setAbierto('none')} className="w-full">
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
