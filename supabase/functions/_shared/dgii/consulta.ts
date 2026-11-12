// La regla de la memoria de consultas de RNC (módulo puro: la base y la DGII
// entran por `DepsConsulta`, así las pruebas las reemplazan por falsas).
//
// Un documento que no pasa el dígito verificador no se consulta. Lo guardado vale
// 30 días si se encontró y 1 día si no (por si lo inscriben enseguida); pasado eso
// se vuelve a preguntar a la DGII. Si la DGII no responde, se devuelve lo último
// que se encontró, marcado como desactualizado. Un fallo de la base no frena la
// consulta: se registra y se sigue.
//
// Solo sintaxis borrable: lo cargan la Edge Function (Deno) y `npm test` (Node).

import { digitosDeDocumento, documentoValido } from './rnc.ts';
import type { DatosDgii, LecturaDgii } from './rnc.ts';

export const DIAS_MEMORIA = 30;
export const DIAS_MEMORIA_NO_ENCONTRADO = 1;

const MS_DIA = 86_400_000;

export interface FilaMemoria {
  rnc: string;
  encontrado: boolean;
  datos: DatosDgii | null;
  consultadoAt: string; // ISO
}

export interface DepsConsulta {
  leerMemoria(rnc: string): Promise<FilaMemoria | null>;
  guardarMemoria(fila: FilaMemoria): Promise<void>;
  consultarDgii(rnc: string): Promise<LecturaDgii>;
  ahora(): Date;
  /** Una línea para el registro de la función. */
  registrar(texto: string): void;
}

export type RespuestaRnc =
  | { ok: true; encontrado: true; datos: DatosDgii; consultadoAt: string; desactualizado: boolean }
  | { ok: true; encontrado: false }
  | { ok: false; motivo: 'documento_invalido' | 'dgii_no_responde' };

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function consultarRnc(texto: string, deps: DepsConsulta): Promise<RespuestaRnc> {
  const rnc = digitosDeDocumento(texto);
  if (!documentoValido(rnc)) return { ok: false, motivo: 'documento_invalido' };

  let memoria: FilaMemoria | null = null;
  try {
    memoria = await deps.leerMemoria(rnc);
  } catch (e) {
    deps.registrar(`dgii-rnc: no se pudo leer la memoria: ${mensajeDe(e)}`);
  }

  const ahora = deps.ahora();
  if (memoria) {
    const edad = ahora.getTime() - new Date(memoria.consultadoAt).getTime();
    if (memoria.encontrado && memoria.datos && edad < DIAS_MEMORIA * MS_DIA) {
      return { ok: true, encontrado: true, datos: memoria.datos, consultadoAt: memoria.consultadoAt, desactualizado: false };
    }
    if (!memoria.encontrado && edad < DIAS_MEMORIA_NO_ENCONTRADO * MS_DIA) {
      return { ok: true, encontrado: false };
    }
  }

  let lectura: LecturaDgii;
  try {
    lectura = await deps.consultarDgii(rnc);
    // La ficha tiene que ser del documento pedido: otra cosa es un enredo de la
    // DGII (o de su sesión) y no se le puede dar al usuario ni guardar.
    if (lectura.encontrado && lectura.datos.rnc !== rnc) {
      throw new Error(`la DGII devolvió el documento ${lectura.datos.rnc} al pedir ${rnc}`);
    }
  } catch (e) {
    deps.registrar(`dgii-rnc: la DGII no respondió: ${mensajeDe(e)}`);
    if (memoria && memoria.encontrado && memoria.datos) {
      return { ok: true, encontrado: true, datos: memoria.datos, consultadoAt: memoria.consultadoAt, desactualizado: true };
    }
    return { ok: false, motivo: 'dgii_no_responde' };
  }

  const consultadoAt = ahora.toISOString();
  const fila: FilaMemoria = lectura.encontrado
    ? { rnc, encontrado: true, datos: lectura.datos, consultadoAt }
    : { rnc, encontrado: false, datos: null, consultadoAt };
  try {
    await deps.guardarMemoria(fila);
  } catch (e) {
    deps.registrar(`dgii-rnc: no se pudo guardar en la memoria: ${mensajeDe(e)}`);
  }

  return lectura.encontrado
    ? { ok: true, encontrado: true, datos: lectura.datos, consultadoAt, desactualizado: false }
    : { ok: true, encontrado: false };
}
