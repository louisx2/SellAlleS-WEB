// Lógica pura de la factura electrónica (e-CF) en la app. Sin dependencias de
// React ni de Supabase, y solo `import type`: las pruebas
// (`scripts/tests/ecf.test.mjs`) cargan este archivo directamente con Node,
// que quita los tipos pero no resuelve imports de valores.
import type { EcfDocumento, EcfEstado, NcfType } from './types';

// Nombre del tipo de comprobante tal como sale en el ticket.
export const ECF_NOMBRE: Record<number, string> = {
  31: 'Factura de Crédito Fiscal Electrónica',
  32: 'Factura de Consumo Electrónica',
  33: 'Nota de Débito Electrónica',
  34: 'Nota de Crédito Electrónica',
  44: 'Comprobante Electrónico para Regímenes Especiales',
  45: 'Comprobante Electrónico Gubernamental',
};

/** ¿Es un e-NCF? E + tipo (2 dígitos) + secuencia (10): 13 caracteres. La serie B no lo es. */
export function esEcf(ncf?: string | null): boolean {
  return /^E\d{12}$/.test(ncf ?? '');
}

/** Tipo (31, 32, 34…) que lleva un e-NCF en los dos dígitos que siguen a la E; undefined si no es e-NCF. */
export function tipoDeEncf(ncf?: string | null): number | undefined {
  return esEcf(ncf) ? Number((ncf as string).slice(1, 3)) : undefined;
}

// Cuando el tipo no está en ECF_NOMBRE (un documento sin tipo, que el mapper
// deja en 0): el ticket nunca debe imprimir "undefined".
const ECF_NOMBRE_GENERICO = 'Comprobante Fiscal Electrónico';

/** Nombre con que el ticket titula el comprobante de este e-NCF. */
export function nombreDeEncf(ncf?: string | null): string {
  const tipo = tipoDeEncf(ncf);
  return (tipo === undefined ? undefined : ECF_NOMBRE[tipo]) ?? ECF_NOMBRE_GENERICO;
}

/**
 * ¿Hay que impedir el cobro porque el comprobante electrónico no se podría
 * armar? El E31, E44 y E45 identifican al comprador y exigen su RNC (9 dígitos)
 * o cédula (11); sin ellos `assign_ncf` gastaría el número y el documento
 * terminaría en error_datos. Solo aplica con e-CF: la serie B sigue como hoy
 * (advertencia, sin bloquear).
 */
export function ecfFaltaRncCliente(ecfActiva: boolean, ncfType: NcfType, customerIdIsValid: boolean): boolean {
  const exigeComprador = ncfType === 'fiscal' || ncfType === 'gubernamental' || ncfType === 'regimen_especial';
  return ecfActiva && exigeComprador && !customerIdIsValid;
}

/**
 * El documento que vale hoy: el más reciente que nadie ha reemplazado. Un
 * documento rechazado que se vuelve a emitir queda con `reemplazadoPor`; el
 * nuevo ocupa su lugar. No altera la lista que recibe.
 */
export function documentoVigente(docs: EcfDocumento[]): EcfDocumento | undefined {
  let vigente: EcfDocumento | undefined;
  for (const d of docs) {
    if (d.reemplazadoPor) continue;
    if (!vigente || d.createdAt.getTime() > vigente.createdAt.getTime()) vigente = d;
  }
  return vigente;
}

const ETIQUETAS: Record<EcfEstado, { texto: string; tono: 'ok' | 'espera' | 'error' }> = {
  por_enviar:           { texto: 'Por enviar',                 tono: 'espera' },
  enviando:             { texto: 'Por enviar',                 tono: 'espera' },
  recibido:             { texto: 'En la DGII',                 tono: 'espera' },
  aceptado:             { texto: 'Aceptado',                   tono: 'ok' },
  aceptado_condicional: { texto: 'Aceptado con observaciones', tono: 'ok' },
  rechazado:            { texto: 'Rechazado',                  tono: 'error' },
  error_datos:          { texto: 'Con error',                  tono: 'error' },
  sin_cupo:             { texto: 'Sin cupo',                   tono: 'error' },
};

/** Texto y tono (color) con que se muestra un estado. */
export function ecfEstadoEtiqueta(e: EcfEstado): { texto: string; tono: 'ok' | 'espera' | 'error' } {
  return ETIQUETAS[e];
}

/** Estados que el servidor no reintenta solo: los resuelve una persona (el aviso, el filtro de Movimientos y el ticket los comparten). */
export const ECF_ESTADOS_CON_PROBLEMA: EcfEstado[] = ['rechazado', 'error_datos', 'sin_cupo'];

/** ¿Está el comprobante en un estado que pide a una persona corregir algo? Sin estado (venta sin e-CF) no. */
export function ecfConProblema(estado?: EcfEstado | null): boolean {
  return !!estado && ECF_ESTADOS_CON_PROBLEMA.includes(estado);
}

/** Se vuelve a enviar tal cual: faltaba un dato que ya se corrigió, o faltaba cupo. */
export function puedeReintentar(d: EcfDocumento): boolean {
  return d.estado === 'error_datos' || d.estado === 'sin_cupo';
}

/** La DGII lo rechazó: no se corrige, se emite uno nuevo que lo reemplaza. */
export function puedeReemitir(d: EcfDocumento): boolean {
  return d.estado === 'rechazado';
}
