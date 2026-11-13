// Condiciones de un proveedor: los días de crédito y el tipo de gasto 606 que se
// guardan en su ficha, y lo que eso pone en una factura nueva de Cuentas por
// Pagar. También el nombre comercial que trae la DGII al escribir su RNC.
// Node carga este archivo en las pruebas: solo `import type`.

import type { Supplier } from '@/lib/types';

/** El tipo de gasto del 606 que trae la factura cuando el proveedor no tiene uno. */
export const TIPO_DE_GASTO_POR_DEFECTO = '09';

/** Lo más largo que se acepta como plazo (un año). */
const MAX_DIAS_DE_CREDITO = 365;

/**
 * Lo escrito en "Días de crédito". Vacío es "sin plazo" (`null`): la factura no
 * sugiere nada. 0 es contado.
 */
export function leerDiasDeCredito(texto: string): { ok: true; dias: number | null } | { ok: false } {
  const t = (texto ?? '').trim();
  if (!t) return { ok: true, dias: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const dias = Number(t);
  return dias <= MAX_DIAS_DE_CREDITO ? { ok: true, dias } : { ok: false };
}

/** La fecha del comprobante (AAAA-MM-DD) más los días de crédito, o nada si no hay plazo. */
export function vencimientoSugerido(fechaEmision: string, diasCredito: number | null | undefined): string | undefined {
  if (!diasCredito || diasCredito <= 0) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaEmision ?? '');
  if (!m) return undefined;
  // En UTC: con la hora local, el cambio de horario podría correr un día.
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + diasCredito));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Lo que pone en la factura elegir el proveedor (el primer campo): su plazo y su
 * tipo de gasto, o lo de siempre (a crédito, sin vencimiento, 09) si no tiene.
 * Cambiar de proveedor reemplaza lo del anterior. Todo se puede cambiar después.
 */
export function condicionesDelProveedor(
  proveedor: Pick<Supplier, 'creditDays' | 'expenseType606'> | undefined,
  fechaEmision: string,
): { condition: 'credit' | 'cash'; dueDate: string; expenseType: string } {
  const dias = proveedor?.creditDays;
  return {
    condition: dias === 0 ? 'cash' : 'credit',
    dueDate: vencimientoSugerido(fechaEmision, dias) ?? '',
    expenseType: proveedor?.expenseType606 || TIPO_DE_GASTO_POR_DEFECTO,
  };
}

/**
 * Al cambiar la fecha del comprobante: el vencimiento nuevo, si el que hay es el
 * que se calculó solo con la fecha anterior. Uno escrito a mano no se toca.
 */
export function vencimientoAlCambiarFecha(
  diasCredito: number | null | undefined,
  fechaAnterior: string,
  fechaNueva: string,
  vencimientoActual: string,
): string | undefined {
  const calculado = vencimientoSugerido(fechaAnterior, diasCredito);
  if (!calculado || calculado !== vencimientoActual) return undefined;
  return vencimientoSugerido(fechaNueva, diasCredito);
}

const normalizar = (s: string) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * El nombre comercial que hay que poner con lo que trajo la DGII, o `undefined`
 * para dejar el campo como está. Se llena si está vacío o si lo que tiene lo puso
 * la DGII con un RNC anterior (`automatico`); lo escrito a mano no se toca. Si la
 * DGII no tiene nombre comercial, se borra solo el que ella había puesto.
 */
export function nombreComercialDeDgii(
  deDgii: string,
  actual: string,
  automatico: string | undefined,
): string | undefined {
  const nuevo = (deDgii ?? '').trim();
  const puestoPorDgii = !!automatico && normalizar(actual) === normalizar(automatico);
  const libre = !normalizar(actual) || puestoPorDgii;
  if (!libre) return undefined;
  if (!nuevo) return puestoPorDgii ? '' : undefined;
  return normalizar(actual) === normalizar(nuevo) ? undefined : nuevo;
}
