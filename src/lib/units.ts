// Catálogo de unidades de medida. La unidad de un producto decide si admite
// cantidades fraccionadas: las contables (unidad, caja, docena…) solo enteros;
// las medibles (libra, metro, galón…) hasta 3 decimales, que es la escala real
// de products.stock y sale_items.quantity — ambos numeric(12,3).
//
// Este archivo NO importa nada: src/lib/types.ts importa UnitCode de aquí.

export type UnitCode =
  // Contables (se venden por pieza)
  | 'und' | 'caja' | 'doc' | 'par' | 'rollo' | 'saco' | 'paq'
  // Peso
  | 'lb' | 'kg' | 'g' | 'oz' | 'qq'
  // Longitud
  | 'm' | 'pie' | 'yd' | 'plg'
  // Volumen
  | 'gal' | 'l' | 'ml';

export interface UnitOfMeasure {
  code: UnitCode;
  singular: string;
  plural: string;
  /** Abreviatura para recibos térmicos y líneas del carrito. */
  short: string;
  /** Decimales admitidos al capturar: 0 = solo enteros. */
  decimals: 0 | 3;
  group: 'contable' | 'medible';
  /** Formas alternativas aceptadas al importar desde CSV. */
  aliases?: string[];
}

export const DEFAULT_UNIT_CODE: UnitCode = 'und';
/** Escala de numeric(12,3) en la base: máscara, redondeo y columna van atados. */
export const QTY_DECIMALS = 3;

/** Redondeo de cantidades. Espejo de round2 en src/lib/utils.ts. */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export const UNITS: UnitOfMeasure[] = [
  { code: 'und',   singular: 'unidad',     plural: 'unidades',    short: 'und',  decimals: 0, group: 'contable', aliases: ['u', 'uds', 'unid', 'pieza', 'pza'] },
  { code: 'caja',  singular: 'caja',       plural: 'cajas',       short: 'caja', decimals: 0, group: 'contable', aliases: ['cj'] },
  { code: 'doc',   singular: 'docena',     plural: 'docenas',     short: 'doc',  decimals: 0, group: 'contable' },
  { code: 'par',   singular: 'par',        plural: 'pares',       short: 'par',  decimals: 0, group: 'contable' },
  { code: 'rollo', singular: 'rollo',      plural: 'rollos',      short: 'rollo', decimals: 0, group: 'contable' },
  { code: 'saco',  singular: 'saco',       plural: 'sacos',       short: 'saco', decimals: 0, group: 'contable', aliases: ['funda', 'fundas'] },
  { code: 'paq',   singular: 'paquete',    plural: 'paquetes',    short: 'paq',  decimals: 0, group: 'contable' },

  { code: 'lb',    singular: 'libra',      plural: 'libras',      short: 'lb',   decimals: 3, group: 'medible', aliases: ['lbs'] },
  { code: 'kg',    singular: 'kilogramo',  plural: 'kilogramos',  short: 'kg',   decimals: 3, group: 'medible', aliases: ['kilo', 'kilos', 'kgs'] },
  { code: 'g',     singular: 'gramo',      plural: 'gramos',      short: 'g',    decimals: 3, group: 'medible', aliases: ['gr', 'grs'] },
  { code: 'oz',    singular: 'onza',       plural: 'onzas',       short: 'oz',   decimals: 3, group: 'medible' },
  { code: 'qq',    singular: 'quintal',    plural: 'quintales',   short: 'qq',   decimals: 3, group: 'medible' },

  { code: 'm',     singular: 'metro',      plural: 'metros',      short: 'm',    decimals: 3, group: 'medible', aliases: ['mt', 'mts'] },
  { code: 'pie',   singular: 'pie',        plural: 'pies',        short: 'pie',  decimals: 3, group: 'medible', aliases: ['ft'] },
  { code: 'yd',    singular: 'yarda',      plural: 'yardas',      short: 'yd',   decimals: 3, group: 'medible', aliases: ['yds'] },
  { code: 'plg',   singular: 'pulgada',    plural: 'pulgadas',    short: 'plg',  decimals: 3, group: 'medible', aliases: ['pulg', 'in'] },

  { code: 'gal',   singular: 'galón',      plural: 'galones',     short: 'gal',  decimals: 3, group: 'medible', aliases: ['gl'] },
  { code: 'l',     singular: 'litro',      plural: 'litros',      short: 'L',    decimals: 3, group: 'medible', aliases: ['lt', 'lts'] },
  { code: 'ml',    singular: 'mililitro',  plural: 'mililitros',  short: 'ml',   decimals: 3, group: 'medible', aliases: ['mls', 'cc'] },
];

const BY_CODE = new Map<string, UnitOfMeasure>(UNITS.map((u) => [u.code, u]));

/** Nunca lanza: un código ausente o desconocido cae a 'und'. Los carritos que
 *  quedaron guardados en localStorage antes de esta función no traen unidad. */
export const getUnit = (code?: string | null): UnitOfMeasure =>
  BY_CODE.get(code ?? '') ?? BY_CODE.get(DEFAULT_UNIT_CODE)!;

export const isUnitCode = (v: unknown): v is UnitCode =>
  typeof v === 'string' && BY_CODE.has(v);

export const normalizeUnitCode = (v: unknown): UnitCode =>
  isUnitCode(v) ? v : DEFAULT_UNIT_CODE;

export const unitAllowsDecimals = (code?: string | null): boolean =>
  getUnit(code).decimals > 0;

/** Cantidad válida para esta unidad: 3 decimales en medibles, entera en contables. */
export const normalizeQty = (qty: number, code?: string | null): number =>
  unitAllowsDecimals(code) ? roundQty(qty) : Math.round(qty);

/** Solo el número, sin residuo flotante: 1.7000000000000002 → "1.7", 3 → "3".
 *  No aplica la precisión de la unidad a propósito: una cantidad histórica de
 *  1.7 cuya unidad se desconoce jamás debe imprimirse como "2" (el recibo diría
 *  algo distinto de lo que se cobró). La unidad gobierna la ENTRADA, no el display. */
export const formatQty = (qty: number): string => {
  if (!Number.isFinite(qty)) return '0';
  return String(roundQty(qty));
};

/** Número + etiqueta larga: "3 unidades", "1 saco", "1.7 lb". */
export const formatQuantity = (qty: number, code?: string | null): string => {
  const u = getUnit(code);
  const n = formatQty(qty);
  if (u.decimals === 0) {
    return `${n} ${Math.abs(roundQty(qty)) === 1 ? u.singular : u.plural}`;
  }
  return `${n} ${u.short}`;
};

/** Compacto para líneas de recibo y carrito: "3", "1.7 lb" (omite "unidades"). */
export const formatQtyCompact = (qty: number, code?: string | null): string => {
  const u = getUnit(code);
  return u.code === DEFAULT_UNIT_CODE ? formatQty(qty) : `${formatQty(qty)} ${u.short}`;
};

/** Máscara del input de cantidad según la unidad: una unidad contable no deja
 *  ni teclear el punto. Acepta coma porque es lo que trae el teclado en RD. */
export const qtyInputRegex = (code?: string | null): RegExp =>
  unitAllowsDecimals(code) ? /^\d{0,6}([.,]\d{0,3})?$/ : /^\d{0,6}$/;

/** "1,7" → 1.7 · "" → NaN (para distinguir "vacío" de "cero"). */
export const parseQtyInput = (raw: string): number =>
  raw.trim() === '' ? NaN : Number(raw.trim().replace(',', '.'));

// Los diacríticos se quitan con la clase Unicode escrita como escape ASCII:
// tenerlos literales en el fuente es frágil frente a editores y codificaciones.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

const normKey = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/\.$/, '');

let ALIAS_MAP: Map<string, UnitCode> | null = null;

/** Resuelve lo que venga en el CSV: código, singular, plural, abreviatura o
 *  alias, sin importar tildes ni mayúsculas ("Galón", "galon", "GAL", "gal."). */
export const parseUnitInput = (raw: string): UnitCode | undefined => {
  if (!raw?.trim()) return undefined;
  if (!ALIAS_MAP) {
    ALIAS_MAP = new Map();
    for (const u of UNITS) {
      for (const key of [u.code, u.singular, u.plural, u.short, ...(u.aliases ?? [])]) {
        ALIAS_MAP.set(normKey(key), u.code);
      }
    }
  }
  return ALIAS_MAP.get(normKey(raw));
};
