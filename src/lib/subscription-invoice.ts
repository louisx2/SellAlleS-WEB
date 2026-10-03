// La factura de un pago de suscripción. El dibujo vive en supabase/functions/_shared/factura-suscripcion.ts,
// compartido con la Edge Function cobro-externo (Anadsll descarga ahí la misma factura). Aquí solo se carga
// jsPDF en el navegador y se guarda o se pasa a base64.
import type { SubscriptionPayment } from '@/lib/types';
import {
  METODO_DE_PAGO, codigoDeFactura, crearFactura, nombreArchivoFactura, numeroDeFactura, type ConstructorPdf,
} from '../../supabase/functions/_shared/factura-suscripcion';

export { METODO_DE_PAGO, codigoDeFactura, nombreArchivoFactura, numeroDeFactura };

async function documentoDe(p: SubscriptionPayment) {
  const JsPDF = (await import('jspdf')).default as unknown as ConstructorPdf;
  return crearFactura(JsPDF, p);
}

export async function descargarFactura(p: SubscriptionPayment): Promise<void> {
  const doc = await documentoDe(p);
  doc.save(nombreArchivoFactura(p));
}

/** El PDF en base64, sin el prefijo data:, que es como lo espera Resend. */
export async function facturaEnBase64(p: SubscriptionPayment): Promise<string> {
  const doc = await documentoDe(p);
  return doc.output('datauristring').split(',')[1];
}
