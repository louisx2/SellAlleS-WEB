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

/** Mensaje listo para WhatsApp con el enlace de descarga. */
export function mensajeWhatsApp(doc: DocumentoVenta, url: string, dias: number, negocio?: string): string {
  const quien = negocio ?? 'nuestro negocio';
  const vence = `El enlace estará disponible por ${dias} días.`;
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
