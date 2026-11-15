// Secuencias de comprobantes (ncf_sequences): lo que comparten el perfil de la
// empresa (serie B, y la E solo para ver) y el panel de facturación electrónica
// del super admin (donde se cargan las E).

import type { TipoSecuencia } from './ecf';

export interface NcfSequenceRow {
  id: string;
  tipo: TipoSecuencia;
  prefix: string | null;
  range_from: number;
  range_to: number;
  current_val: number;
  expires_at: string | null;
  active: boolean;
  electronica: boolean;
}

export const COLUMNAS_SECUENCIA =
  'id, tipo, prefix, range_from, range_to, current_val, expires_at, active, electronica';

export const TIPO_LABEL: Record<TipoSecuencia, string> = {
  consumer: 'Consumidor Final (B02)',
  fiscal: 'Crédito Fiscal (B01)',
  nota_credito: 'Nota de Crédito (B04)',
  gubernamental: 'Gubernamental (B15)',
  regimen_especial: 'Régimen Especial (B14)',
  nota_debito: 'Nota de Débito (B03)',
};

export const TIPO_LABEL_E: Record<TipoSecuencia, string> = {
  consumer: 'Consumidor Final (E32)',
  fiscal: 'Crédito Fiscal (E31)',
  nota_credito: 'Nota de Crédito (E34)',
  gubernamental: 'Gubernamental (E45)',
  regimen_especial: 'Régimen Especial (E44)',
  nota_debito: 'Nota de Débito (E33)',
};

/** El nombre del tipo según la serie de la secuencia. */
export const etiquetaDeSecuencia = (seq: NcfSequenceRow): string =>
  (seq.electronica ? TIPO_LABEL_E : TIPO_LABEL)[seq.tipo] ?? seq.tipo;

// Aviso cuando a una secuencia en uso le quedan pocos números: sin esto el
// aviso llega el día que el POS deja de facturar. El umbral se mide contra el
// tamaño del rango, no en absoluto: 50 sobre un talonario de 500 avisa a
// tiempo, pero sobre uno de 15 estaría encendido desde el primer día.
const UMBRAL_MAXIMO = 50;
export const umbralPorAgotarse = (seq: NcfSequenceRow): number => {
  const total = Math.max(seq.range_to - seq.range_from + 1, 1);
  return Math.min(UMBRAL_MAXIMO, Math.max(3, Math.ceil(total * 0.2)));
};

export type EstadoSeq = {
  label: 'Agotada' | 'Vencida' | 'Inactiva' | 'Activa';
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  disponibles: number;
  /** La base la tomaría ahora mismo (mismo filtro que assign_ncf). */
  usable: boolean;
};

// Espeja exactamente el filtro de assign_ncf: active, con números y sin vencer.
// Si esto y la función se separan, la pantalla miente sobre lo que hará el POS.
export const estadoDeSecuencia = (seq: NcfSequenceRow, hoy: string): EstadoSeq => {
  const disponibles = Math.max(seq.range_to - seq.current_val + 1, 0);
  if (seq.current_val > seq.range_to) {
    return { label: 'Agotada', variant: 'destructive', disponibles: 0, usable: false };
  }
  if (seq.expires_at && seq.expires_at < hoy) {
    return { label: 'Vencida', variant: 'destructive', disponibles, usable: false };
  }
  if (!seq.active) {
    return { label: 'Inactiva', variant: 'secondary', disponibles, usable: false };
  }
  return { label: 'Activa', variant: 'default', disponibles, usable: true };
};

/**
 * ¿Hay una secuencia E de este tipo que la base tomaría hoy? Para el E32 es la
 * misma condición que pide `ecf_cambiar_estado` para activar.
 */
export const hayEVigente = (seqs: NcfSequenceRow[], tipo: TipoSecuencia, hoy: string): boolean =>
  seqs.some((s) => s.electronica && s.tipo === tipo && estadoDeSecuencia(s, hoy).usable);
