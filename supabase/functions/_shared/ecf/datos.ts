// Armado de `DatosEcf` a partir de las filas que lee la Edge Function (módulo
// puro: sin red ni base de datos). La Edge Function solo busca las filas; las
// reglas de qué fecha, qué cliente y qué referencia lleva cada comprobante
// viven aquí para poder probarlas sin Deno.
//
// Lo comparten la Edge Function (Deno) y las pruebas de `npm test` (Node), que
// lo cargan quitando los tipos: por eso solo usa sintaxis borrable (nada de
// enum, namespace ni parameter properties), sin APIs de Node ni de Deno y con
// imports `.ts`.

import { fechaLocal } from './armar.ts';
import type { DatosEcf, LineaEcf, TipoEcf } from './armar.ts';

export const DIAS_LIMITE_PAGO_FIADO = 30;
export const DIAS_NOTA_SIN_INDICADOR = 30;

const MS_DIA = 86_400_000;

const partes = (ymd: string): [number, number, number] => {
  const [a, m, d] = ymd.split('-').map(Number);
  return [a, m - 1, d];
};

/** 'YYYY-MM-DD' más `dias` días (calendario, sin horas de por medio). */
export function sumarDias(ymd: string, dias: number): string {
  const [a, m, d] = partes(ymd);
  return new Date(Date.UTC(a, m, d + dias)).toISOString().slice(0, 10);
}

/** Días calendario entre dos 'YYYY-MM-DD' (negativo si `hasta` es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  return Math.round((Date.UTC(a2, m2, d2) - Date.UTC(a1, m1, d1)) / MS_DIA);
}

export interface FilaSecuencia {
  prefix: string | null;
  range_from: number | string;
  range_to: number | string;
  expires_at: string | null;
}

/**
 * Vencimiento de la secuencia electrónica de la que salió el e-NCF: la que tiene
 * el mismo prefijo (E31, E32...) y cuyo rango contiene el número.
 */
export function vencimientoDeSecuencia(encf: string, secuencias: FilaSecuencia[]): string | undefined {
  const prefijo = encf.slice(0, 3);
  const numero = Number(encf.slice(3));
  const s = secuencias.find(
    (x) => x.prefix === prefijo && numero >= Number(x.range_from) && numero <= Number(x.range_to),
  );
  return s?.expires_at ?? undefined;
}

export interface EntradaDatos {
  tipo: TipoEcf;
  encf: string;
  /** Zona horaria de la empresa: el día del comprobante es el de RD, no el de UTC. */
  zona: string;
  emisor: DatosEcf['emisor'];
  /** La venta (en una nota de crédito, la venta original que se anula). */
  venta: {
    created_at: string;
    total: number;
    itbis_amount: number;
    itbis_included: boolean | null;
    payment_status: string;
  };
  lineas: LineaEcf[];
  cliente: { name: string | null; rnc: string | null } | null;
  /** 'YYYY-MM-DD' de la última cuota si la venta es a plazos. */
  ultimaCuota?: string | null;
  vencimientoSecuencia?: string;
  /** Solo en una nota de crédito (E34). */
  nota?: { created_at: string; total: number; itbis_amount: number; encfOriginal: string };
}

/** Lo que se le pasa a `armarEcf`. Lanza si falta la nota de un E34. */
export function datosEcf(e: EntradaDatos): DatosEcf {
  const fechaVenta = fechaLocal(e.venta.created_at, e.zona);
  const comprador = e.cliente ? { rnc: e.cliente.rnc ?? '', nombre: e.cliente.name ?? '' } : null;
  const esNota = e.tipo === 34;

  if (esNota && !e.nota) throw new Error('Falta la nota de crédito para armar el E34.');

  // La nota de crédito siempre va "de contado" (R13): no lleva fecha límite de pago.
  const aCredito = !esNota && e.venta.payment_status !== 'paid';

  const d: DatosEcf = {
    tipo: e.tipo,
    encf: e.encf,
    fechaEmision: fechaVenta,
    emisor: e.emisor,
    comprador,
    itbisIncluido: e.venta.itbis_included === true,
    aCredito,
    lineas: e.lineas,
    totalGuardado: e.venta.total,
    itbisGuardado: e.venta.itbis_amount,
  };

  if (e.vencimientoSecuencia) d.vencimientoSecuencia = e.vencimientoSecuencia;

  if (aCredito) {
    // La última cuota si es a plazos; si es fiada, la venta más 30 días.
    d.fechaLimitePago = e.ultimaCuota || sumarDias(fechaVenta, DIAS_LIMITE_PAGO_FIADO);
  }

  if (esNota && e.nota) {
    const fechaNota = fechaLocal(e.nota.created_at, e.zona);
    d.fechaEmision = fechaNota;
    d.totalGuardado = e.nota.total;
    d.itbisGuardado = e.nota.itbis_amount;
    d.referencia = {
      encf: e.nota.encfOriginal,
      fechaEmision: fechaVenta,
      masDe30Dias: diasEntre(fechaVenta, fechaNota) > DIAS_NOTA_SIN_INDICADOR,
    };
  }

  return d;
}
