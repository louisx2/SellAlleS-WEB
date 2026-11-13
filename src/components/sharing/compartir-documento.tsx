'use client';

import { useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Copy, Download, Link as LinkIcon, Loader2, Mail, MessageSquare, Send } from 'lucide-react';
import { useCompartirDocumento, type CompartirDocumento as Compartir } from '@/hooks/use-compartir-documento';
import { diasDeValidez, vigenciaDelEnlace, type DocumentoVenta } from '@/lib/documentos-venta';
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

interface CompartirDocumentoProps {
  sale: Sale;
  documento: DocumentoVenta;
  /** Elemento fuera de pantalla, a 100 mm, del que se saca el PDF. */
  pdfRef: RefObject<HTMLDivElement>;
}

/** Botones WhatsApp / Correo / Descargar PDF de un documento de la venta, con
 *  sus diálogos. Lo usan el detalle de la venta, el plan de pagos y el estado
 *  del financiamiento. */
export function CompartirDocumento({ sale, documento, pdfRef }: CompartirDocumentoProps) {
  const c = useCompartirDocumento({ sale, documento, pdfRef });
  const [abierto, setAbierto] = useState<'none' | 'whatsapp' | 'correo'>('none');

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
        onClick={() => setAbierto('whatsapp')}
      >
        <MessageSquare className="mr-1.5 h-4 w-4" />
        WhatsApp
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAbierto('correo')}>
        <Mail className="mr-1.5 h-4 w-4" />
        Correo
      </Button>
      <Button variant="outline" size="sm" onClick={c.descargarPdf}>
        <Download className="mr-1.5 h-4 w-4" />
        Descargar PDF
      </Button>

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
