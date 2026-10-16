// Lógica pura de Ventas Rápidas: artículos que se venden en el POS sin estar en
// el inventario. Sin dependencias de React ni de Supabase, y solo `import type`:
// las pruebas (`scripts/tests/quick-sales.test.mjs`) cargan este archivo
// directamente con Node, que quita los tipos pero no resuelve imports de valores.
import type { CartItem } from './types';
import type { UnitCode } from './units';

// Descripción por defecto de la pestaña "Monto" cuando no se escribe otra.
export const QUICK_DEFAULT_NAME = 'Varios';

export type QuickItemInput = {
  name: string;
  price: number;
  quantity: number;
  itbis: boolean;
  cost?: number;
};

// Artículo rápido vendido antes (lo devuelve `articulos_rapidos_recientes`).
export type RecentQuickItem = {
  name: string;
  price: number;
  cost: number | null;
  itbis: boolean;
  lastSoldAt: string;
};

// Una línea vendida tal como la lee el reporte de Ventas Rápidas.
// `itbisIncluded` es el de la venta (congelado al cobrar), no el de la sucursal hoy.
export type QuickReportLine = {
  quantity: number;
  price: number;
  customPrice: number | null;
  cost: number | null;
  itbis: boolean;
  itbisIncluded: boolean;
};

const QUICK_UNIT: UnitCode = 'und';

// El `|| 0` descarta el -0: Math.round(-0.4) da -0 y el reporte lo mostraría
// como "-0.00" en una línea en el punto de equilibrio con ruido de coma flotante.
const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

// Igual que la columna normalizada de la base:
// lower(regexp_replace(btrim(name), '\s+', ' ', 'g')).
export function normalizeQuickName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Devuelve el primer error en el orden descripción, precio, cantidad, costo.
// El costo es opcional, pero si viene no puede ser negativo (ni NaN).
export function validateQuickItem(input: QuickItemInput): string | null {
  if (input.name.trim() === '') return 'Escribe la descripción del artículo.';
  if (!Number.isFinite(input.price)) return 'Escribe un precio válido.';
  if (input.price < 0) return 'El precio no puede ser negativo.';
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return 'La cantidad debe ser un número entero mayor que cero.';
  }
  if (input.cost != null && (!Number.isFinite(input.cost) || input.cost < 0)) {
    return 'El costo no puede ser negativo.';
  }
  return null;
}

// Línea de carrito con un producto sintético: sin id, sin existencias y sin
// control de stock. `cost` queda en undefined si no se dio (la base lo guarda nulo).
export function buildQuickCartItem(input: QuickItemInput, cartItemId: string): CartItem {
  const name = input.name.trim();
  return {
    cartItemId,
    product: {
      id: '',
      code: '',
      name,
      price: input.price,
      cost: input.cost ?? 0,
      itbis: input.itbis,
      image: '',
      stock: 0,
      unit: QUICK_UNIT,
      tracksStock: false,
    },
    quantity: input.quantity,
    isQuick: true,
    cost: input.cost,
  };
}

// El precio tecleado es el final: sin precio por mayor ni descuento del cliente.
export function quickUnitPrice(item: CartItem): number {
  return item.customPrice ?? item.product.price;
}

// Rápido que no trae costo: no se puede calcular su ganancia. Un costo de 0 es un
// costo dado a propósito y cuenta como costeado.
export function isUncostedQuick(item: CartItem): boolean {
  return !!item.isQuick && item.cost == null;
}

// Sugerencias del diálogo: filtra por nombre normalizado, con `includes`.
// Sin término devuelve los primeros `limit` (ya vienen del más reciente al más viejo).
export function filterRecentQuickItems(
  items: RecentQuickItem[],
  term: string,
  limit = 5,
): RecentQuickItem[] {
  const needle = normalizeQuickName(term);
  if (needle === '') return items.slice(0, limit);
  return items
    .filter((item) => normalizeQuickName(item.name).includes(needle))
    .slice(0, limit);
}

// Base gravable de una línea: el precio cobrado sin el ITBIS que lleva dentro.
// Si la línea no lleva ITBIS, o la venta lo cobró aparte, el bruto ya es la base.
function baseOfGross(gross: number, itbis: boolean, itbisIncluded: boolean, itbisRate: number): number {
  return round2(itbis && itbisIncluded ? gross / (1 + itbisRate) : gross);
}

export function lineBase(item: CartItem, itbisIncluded: boolean, itbisRate: number): number {
  return baseOfGross(item.quantity * quickUnitPrice(item), item.product.itbis, itbisIncluded, itbisRate);
}

// Clave de agrupación de "Más vendidos": las líneas rápidas no tienen id de
// producto, así que se agrupan por descripción normalizada.
export function topProductKey(item: CartItem): string {
  return item.isQuick ? `rapido:${normalizeQuickName(item.product.name)}` : item.product.id;
}

// Totales del reporte de Ventas Rápidas. `total` y `uncostedAmount` son brutos
// (lo cobrado); `profit` es base sin ITBIS menos costo, solo de las líneas con costo.
export function summarizeQuickLines(
  lines: QuickReportLine[],
  itbisRate: number,
): { total: number; totalWithCost: number; profit: number; uncostedCount: number; uncostedAmount: number } {
  let total = 0;
  let totalWithCost = 0;
  let profit = 0;
  let uncostedCount = 0;
  let uncostedAmount = 0;

  for (const line of lines) {
    const gross = line.quantity * (line.customPrice ?? line.price);
    total += gross;
    if (line.cost == null) {
      uncostedCount += 1;
      uncostedAmount += gross;
    } else {
      totalWithCost += gross;
      profit += baseOfGross(gross, line.itbis, line.itbisIncluded, itbisRate) - line.quantity * line.cost;
    }
  }

  return {
    total: round2(total),
    totalWithCost: round2(totalWithCost),
    profit: round2(profit),
    uncostedCount,
    uncostedAmount: round2(uncostedAmount),
  };
}
