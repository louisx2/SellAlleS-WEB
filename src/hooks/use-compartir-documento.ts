'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useToast } from '@/hooks/use-toast';
import {
  abrirPestanaParaWhatsApp,
  abrirWhatsAppConEnlace,
  downloadReceiptPdfFile,
  generateReceiptPdf,
  sendReceiptViaResendEmail,
  shareSalePdfLinkViaWhatsApp,
} from '@/lib/receipt-sharing';
import { nombreArchivoPdf, type DocumentoVenta } from '@/lib/documentos-venta';
import type { Sale } from '@/lib/types';

const NOMBRE: Record<DocumentoVenta, string> = {
  factura: 'La factura',
  plan: 'El plan de pagos',
  estado: 'El estado del financiamiento',
};

export interface CompartirDocumento {
  documento: DocumentoVenta;
  sale: Sale;
  correo: string;
  setCorreo: (correo: string) => void;
  enviandoCorreo: boolean;
  /** true si salió; los errores se avisan con un toast. */
  enviarCorreo: () => Promise<boolean>;
  enviandoEnlace: boolean;
  enlace: { url: string; diasValidez: number } | null;
  compartirWhatsApp: () => Promise<void>;
  copiarEnlace: () => Promise<void>;
  reabrirWhatsApp: () => void;
  descargarPdf: () => Promise<void>;
}

/** Todo lo que hace falta para mandar un documento de la venta (factura, plan de
 *  pagos o estado del financiamiento) por WhatsApp o correo, o descargarlo.
 *
 *  `pdfRef` es el elemento fuera de pantalla, a 100 mm, del que se saca el PDF:
 *  sin barras ni botones (ver la nota en receipt-dialog). */
export function useCompartirDocumento({
  sale,
  documento,
  pdfRef,
}: {
  sale: Sale;
  documento: DocumentoVenta;
  pdfRef: RefObject<HTMLDivElement>;
}): CompartirDocumento {
  const { toast } = useToast();
  const { profile } = useCompanyProfile();
  const [correo, setCorreo] = useState(sale.customer?.email || '');
  const [enviandoCorreo, setEnviandoCorreo] = useState(false);
  const [enviandoEnlace, setEnviandoEnlace] = useState(false);
  // Enlace ya generado: se deja a la vista para copiarlo o reabrir el chat si
  // el navegador bloqueó la pestaña.
  const [enlace, setEnlace] = useState<{ url: string; diasValidez: number } | null>(null);

  // Otra venta, otro cliente: ni el correo ni el enlace de la anterior sirven.
  useEffect(() => {
    setCorreo(sale.customer?.email || '');
    setEnlace(null);
  }, [sale.id, sale.customer?.email]);

  const filename = nombreArchivoPdf(documento, sale);

  // Sube el PDF y abre WhatsApp con el enlace de descarga. WhatsApp no deja
  // adjuntar archivos desde un enlace, así que esta es la única forma de que el
  // cajero no tenga que descargar y adjuntar a mano.
  const compartirWhatsApp = async () => {
    if (!pdfRef.current) return;
    // Se abre YA, dentro del clic. Generar y subir el PDF tarda más de lo que
    // dura el permiso del navegador para abrir ventanas, así que dejarlo para
    // el final hace que la bloquee.
    const ventana = abrirPestanaParaWhatsApp();
    setEnviandoEnlace(true);
    try {
      const pdfBase64 = await generateReceiptPdf(pdfRef.current, filename);
      const { url, diasValidez, abrioWhatsApp } = await shareSalePdfLinkViaWhatsApp(
        sale.id, pdfBase64, sale, profile.name, ventana, documento,
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
      setEnviandoEnlace(false);
    }
  };

  const copiarEnlace = async () => {
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

  const reabrirWhatsApp = () => {
    if (enlace) abrirWhatsAppConEnlace(sale, enlace.url, enlace.diasValidez, profile.name, documento);
  };

  const enviarCorreo = async (): Promise<boolean> => {
    const destino = correo.trim();
    if (!destino || !destino.includes('@')) {
      toast({
        title: 'Correo inválido',
        description: 'Por favor ingrese una dirección de correo electrónico válida.',
        variant: 'destructive',
      });
      return false;
    }
    setEnviandoCorreo(true);
    try {
      if (!pdfRef.current) {
        throw new Error('No se pudo ubicar el documento para generar el PDF.');
      }
      const pdfBase64 = await generateReceiptPdf(pdfRef.current, filename);
      await sendReceiptViaResendEmail(sale.id, destino, pdfBase64, filename, sale, profile.name, documento);
      toast({
        title: '¡Correo enviado!',
        description: `${NOMBRE[documento]} se envió correctamente a ${destino}.`,
      });
      return true;
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'Error al enviar correo',
        description: error?.message || 'No se pudo enviar el correo. Intenta de nuevo.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setEnviandoCorreo(false);
    }
  };

  const descargarPdf = async () => {
    try {
      if (!pdfRef.current) {
        throw new Error('No se pudo ubicar el documento.');
      }
      await downloadReceiptPdfFile(pdfRef.current, filename);
      toast({
        title: 'Descarga iniciada',
        description: `${NOMBRE[documento]} en PDF se ha descargado correctamente.`,
      });
    } catch (error: any) {
      toast({
        title: 'Error al generar PDF',
        description: error?.message || 'No se pudo descargar el archivo PDF.',
        variant: 'destructive',
      });
    }
  };

  return {
    documento, sale, correo, setCorreo, enviandoCorreo, enviarCorreo,
    enviandoEnlace, enlace, compartirWhatsApp, copiarEnlace, reabrirWhatsApp, descargarPdf,
  };
}
