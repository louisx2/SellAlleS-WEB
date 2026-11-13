// Qué documento de una venta se comparte: la factura de siempre, el plan de
// pagos del financiamiento o el estado del financiamiento (cuotas y abonos).
//
// La factura conserva su ruta, su nombre de descarga y sus textos tal como
// eran: un front viejo que no manda `documento` y los enlaces ya enviados no
// notan nada. Cada documento tiene su propia ruta para que mandar el plan no
// pise el PDF (ni el enlace) de la factura que el cliente ya tiene.
//
// Lo prueban scripts/tests/documentos-edge.test.mjs con `node --test`: sin
// imports y solo sintaxis TS borrable.

export type DocumentoVenta = 'factura' | 'plan' | 'estado';

export function documentoValido(x: unknown): DocumentoVenta {
  return x === 'plan' || x === 'estado' ? x : 'factura';
}

const SUFIJO: Record<DocumentoVenta, string> = { factura: '', plan: '-plan', estado: '-estado' };

/** Ruta por empresa en el bucket `comprobantes`. */
export function rutaDelDocumento(companyId: string, saleId: string, doc: DocumentoVenta): string {
  return `${companyId}/${saleId}${SUFIJO[doc]}.pdf`;
}

/** Con qué nombre le llega el archivo al cliente (y no el uuid de la venta). */
export function nombreDeDescarga(doc: DocumentoVenta, ncf?: string | null): string {
  if (doc === 'plan') return 'plan-de-pagos.pdf';
  if (doc === 'estado') return 'estado-de-financiamiento.pdf';
  return `comprobante${ncf ? `-${ncf}` : ''}.pdf`;
}

const TITULO: Record<DocumentoVenta, string> = {
  factura: 'Comprobante de Compra',
  plan: 'Plan de Pagos',
  estado: 'Estado de su Financiamiento',
};

export function tituloDelCorreo(doc: DocumentoVenta): string {
  return TITULO[doc];
}

export function asuntoDelCorreo(doc: DocumentoVenta, companyName: string, ncf?: string | null): string {
  const conNcf = doc === 'factura' && ncf ? ` NCF ${ncf}` : '';
  return `${TITULO[doc]}${conNcf} - ${companyName}`;
}

/** Comprobantes que identifican al comprador: crédito fiscal, regímenes
 *  especiales y gubernamental, en papel (B) o electrónicos (E). Los mismos que
 *  exigen RNC en el 607 y en el e-CF. */
const TIPOS_CON_COMPRADOR = ['B01', 'B14', 'B15', 'E31', 'E44', 'E45'];

/** Días que vive el enlace desde que se manda (cada envío lo renueva). La
 *  factura con comprobante que identifica al comprador dura más: su contador la
 *  necesita para el 606 del mes siguiente y 15 días no le alcanzan. Más que eso
 *  no: lleva RNC y montos, y el enlace se puede reenviar a cualquiera. */
export function diasDeValidez(doc: DocumentoVenta, ncf?: string | null): number {
  if (doc !== 'factura') return 15;
  const tipo = (ncf ?? '').trim().toUpperCase().slice(0, 3);
  return TIPOS_CON_COMPRADOR.includes(tipo) ? 90 : 15;
}

/** Lo que dice el correo que va adjunto: "...encontrará <esto>." */
export function adjuntoDelCorreo(doc: DocumentoVenta): string {
  if (doc === 'plan') return 'su plan de pagos en formato PDF';
  if (doc === 'estado') return 'el estado de su financiamiento en formato PDF';
  return 'su factura en formato PDF';
}
