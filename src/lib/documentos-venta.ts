// Los documentos de una venta que se pueden mandar al cliente: la factura, el
// plan de pagos y el estado del financiamiento. El mismo literal que entiende
// el servidor (supabase/functions/_shared/documentos.ts).
//
// Lo prueban con `node --test`: sin imports y solo sintaxis TS borrable.

export type DocumentoVenta = 'factura' | 'plan' | 'estado';

/** Cómo se llama el PDF descargado o adjunto al correo. */
export function nombreArchivoPdf(doc: DocumentoVenta, sale: { id: string; ncf?: string }): string {
  const corto = sale.id.slice(0, 8);
  if (doc === 'plan') return `plan_de_pagos_${corto}.pdf`;
  if (doc === 'estado') return `estado_financiamiento_${corto}.pdf`;
  return `factura_${sale.ncf || corto}.pdf`;
}

/** Comprobantes que identifican al comprador (crédito fiscal, regímenes
 *  especiales, gubernamental). Igual que en el servidor: supabase/functions/
 *  _shared/documentos.ts; una prueba comprueba que no se separen. */
const TIPOS_CON_COMPRADOR = ['B01', 'B14', 'B15', 'E31', 'E44', 'E45'];

/** Días que vive el enlace desde que se manda: 90 para la factura con un
 *  comprobante que identifica al comprador (su contador la necesita para el
 *  606), 15 para lo demás. Quien manda es el servidor; esto es para avisarle al
 *  cajero antes de generar el enlace. */
export function diasDeValidez(doc: DocumentoVenta, ncf?: string | null): number {
  if (doc !== 'factura') return 15;
  const tipo = (ncf ?? '').trim().toUpperCase().slice(0, 3);
  return TIPOS_CON_COMPRADOR.includes(tipo) ? 90 : 15;
}

/** Cuánto vive el enlace que devolvió el servidor. */
export interface ValidezEnlace {
  dias: number;
  /** Fecha exacta de vencimiento (ISO). Un servidor viejo no la manda. */
  venceEl?: string;
}

/** "hasta el 28 de noviembre de 2026", en hora de Santo Domingo; sin fecha,
 *  "por 15 días". Con la fecha no queda duda de desde cuándo cuenta. */
export function vigenciaDelEnlace({ dias, venceEl }: ValidezEnlace): string {
  if (!venceEl) return `por ${dias} días`;
  const fecha = new Date(venceEl).toLocaleDateString('es-DO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo',
  });
  return `hasta el ${fecha}`;
}

/** Mensaje listo para WhatsApp con el enlace de descarga. */
export function mensajeWhatsApp(doc: DocumentoVenta, url: string, validez: ValidezEnlace, negocio?: string): string {
  const quien = negocio ?? 'nuestro negocio';
  const vence = `El enlace estará disponible ${vigenciaDelEnlace(validez)}.`;
  if (doc === 'plan') {
    return `Le compartimos el plan de pagos de su compra en ${quien}.\n\n` +
      `Aquí puede descargarlo en PDF:\n${url}\n\n${vence}`;
  }
  if (doc === 'estado') {
    return `Le compartimos el estado de su financiamiento con ${quien}: cuotas, pagos realizados y balance pendiente.\n\n` +
      `Aquí puede descargarlo en PDF:\n${url}\n\n${vence}`;
  }
  return `¡Gracias por su compra en ${quien}!\n\n` +
    `Aquí puede descargar su comprobante en PDF:\n${url}\n\n${vence}`;
}

/** ¿La ruta que devolvió el servidor es la de este documento? Una función
 *  receipt-link anterior a los documentos ignora `documento` y devuelve la ruta
 *  de la factura: subir el plan ahí pisaría el PDF (y el enlace) de la factura
 *  que el cliente ya tiene. Se comprueba antes de subir. */
export function rutaCorrespondeAlDocumento(ruta: string, doc: DocumentoVenta): boolean {
  if (doc === 'factura') return true;
  return ruta.endsWith(`-${doc}.pdf`);
}
