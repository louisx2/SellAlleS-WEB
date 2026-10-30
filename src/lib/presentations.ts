// Lógica pura de presentaciones de producto: vender por unidad, paquete o caja.
// El stock siempre se cuenta en unidades base; una presentación solo dice cuántas
// unidades trae y a qué precio se vende. Sin dependencias de React ni de Supabase,
// y solo `import type`: las pruebas (`scripts/tests/presentations.test.mjs`)
// cargan este archivo directamente con Node, que quita los tipos pero no resuelve
// imports de valores. Por eso el redondeo es local y la unidad llega como
// parámetro (`unitShort`, `decimals`) en vez de importarla de `./units`.
import type { CartItem, LinePresentation, Product, ProductPresentation } from './types';

// Escala de numeric(12,3), igual que `roundQty` en `./units`.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Tolerancia al dividir existencias entre unidades: 0.3 / 0.1 da 2.9999999999999996.
const EPS = 1e-9;

// Cuántas presentaciones se muestran/leen en el CSV.
const CSV_SLOTS = 3;

const num = (n: number) => String(round3(n));

// ---------- Consultas sobre el producto ----------

// Copia ordenada de menor a mayor cantidad de unidades; no toca la lista del producto.
export function presentationsOf(product: Product): ProductPresentation[] {
  return [...(product.presentations ?? [])].sort((a, b) => a.units - b.units);
}

// undefined = se vende suelto: los productos anteriores a las presentaciones no cambian.
export function isSoldLoose(product: Product): boolean {
  return product.soldLoose !== false;
}

// "Paquete x12", "Saco x125 lb". La unidad 'und' se omite, como en el resto de la app.
export function presentationLabel(p: { name: string; units: number }, unitShort: string): string {
  const suffix = unitShort === 'und' || unitShort === '' ? '' : ` ${unitShort}`;
  return `${p.name} x${num(p.units)}${suffix}`;
}

// Texto corto para el botón de la tarjeta: hasta 6 letras igual; si no, 3 + punto.
export function buttonLabel(name: string): string {
  const letters = Array.from(name.trim());
  return letters.length <= 6 ? letters.join('') : `${letters.slice(0, 3).join('')}.`;
}

// ---------- Carrito ----------

// Unidades base de una línea. Una línea sin presentación (carritos viejos en
// localStorage, ventas anteriores a la migración) es suelta: 1 unidad por unidad.
export function lineBaseQty(item: { quantity: number; presentation?: LinePresentation }): number {
  return round3(item.quantity * (item.presentation?.units ?? 1));
}

// Unidades base de un producto que ya están en el carrito, sumando todas sus líneas
// (sueltas y por presentación). `exceptCartItemId` deja fuera la línea que se edita.
export function baseQtyInCart(productId: string, items: CartItem[], exceptCartItemId?: string): number {
  let total = 0;
  for (const item of items) {
    if (item.product.id !== productId) continue;
    if (exceptCartItemId !== undefined && item.cartItemId === exceptCartItemId) continue;
    total += lineBaseQty(item);
  }
  return round3(total);
}

// Cuántas presentaciones de `units` unidades base caben todavía, contando lo que ya
// hay en el carrito: enteras, porque una presentación no se parte. Con `units === 1`
// (venta suelta) devuelve el saldo exacto en unidades base, sin redondear hacia abajo:
// una unidad medible puede venderse por fracciones (0.5 lb sigue siendo vendible).
// Sin control de inventario no hay tope.
export function maxAddable(product: Product, items: CartItem[], units: number): number {
  if (!product.tracksStock) return Infinity;
  if (!(units > 0)) return 0;
  const remaining = round3(product.stock - baseQtyInCart(product.id, items));
  if (remaining <= 0) return 0;
  if (units === 1) return remaining;
  return Math.floor(remaining / units + EPS);
}

// ¿Hay algo que vender ahora? Suelto: basta con que haya existencias. Si no se vende
// suelto, tiene que alcanzar para la presentación más chica.
export function isSellable(product: Product): boolean {
  if (!product.tracksStock) return true;
  if (isSoldLoose(product)) return product.stock > 0;
  const smallest = presentationsOf(product)[0];
  return smallest !== undefined && smallest.units <= product.stock + EPS;
}

// El producto tal como lo lleva la línea: con presentación, `price` es el de la
// presentación (el precio de lista de la línea). El precio por mayor es por unidad
// base, así que la línea no lo hereda: de lo contrario, al llegar al mínimo de
// paquetes se cobraría cada uno al precio de una unidad. Sin presentación, el mismo
// objeto.
export function lineProduct(product: Product, p?: ProductPresentation): Product {
  return p
    ? { ...product, price: p.price, wholesalePrice: undefined, wholesaleMinQuantity: undefined }
    : product;
}

export function toLinePresentation(p: ProductPresentation): LinePresentation {
  return { id: p.id, name: p.name, units: p.units };
}

// Búsqueda por código escrito o escaneado, sin distinguir mayúsculas ni espacios en
// los bordes. El código del producto gana sobre el de una presentación, igual que
// en la base (donde un código no se puede repetir en la sucursal).
export function findByCode(
  code: string,
  products: Product[],
): { product: Product; presentation?: ProductPresentation } | undefined {
  const needle = code.trim().toLowerCase();
  if (needle === '') return undefined;

  for (const product of products) {
    if ((product.code ?? '').trim().toLowerCase() === needle) return { product };
  }
  for (const product of products) {
    for (const presentation of product.presentations ?? []) {
      if ((presentation.code ?? '').trim().toLowerCase() === needle) return { product, presentation };
    }
  }
  return undefined;
}

// ---------- Existencias ----------

// Reparte las existencias de la presentación mayor a la menor y deja el resto
// suelto (`name: null`). 1250 und con Caja 288 y Paquete 12 → 4 Caja, 8 Paquete, 2 sueltas.
export function breakdownStock(
  stock: number,
  presentations: { name: string; units: number }[],
): { name: string | null; count: number }[] {
  if (!Number.isFinite(stock) || stock <= 0) return [];

  const parts: { name: string | null; count: number }[] = [];
  const bySize = presentations.filter((p) => p.units > 0).sort((a, b) => b.units - a.units);
  let rest = round3(stock);
  for (const p of bySize) {
    const count = Math.floor(rest / p.units + EPS);
    if (count <= 0) continue;
    parts.push({ name: p.name, count });
    rest = Math.max(0, round3(rest - count * p.units));
  }
  if (rest > 0) parts.push({ name: null, count: rest });
  return parts;
}

// "4 Caja, 8 Paq., 2 und". Sin partes (sin existencias) dice "0 und".
export function formatBreakdown(parts: { name: string | null; count: number }[], unitShort: string): string {
  if (parts.length === 0) return `0 ${unitShort}`;
  return parts
    .map((part) => `${num(part.count)} ${part.name === null ? unitShort : buttonLabel(part.name)}`)
    .join(', ');
}

// ---------- Formulario del producto ----------

// Fila del formulario: los campos numéricos pueden estar vacíos mientras se escribe.
export interface PresentationDraft {
  id?: string;
  name: string;
  units: number | '';
  price: number | '';
  code: string;
}

// Presentación ya validada, lista para mandar a la base.
export type PresentationInput = { name: string; units: number; price: number; code?: string };

// Primer error del formulario, con los mismos textos que el trigger
// `product_presentations_before_write` y `save_product_presentations` (ver la
// migración 20261029120000), o null si está bien. Se revisa fila por fila, en el
// orden de la base: nombre, unidades, entero, precio, nombre repetido, código.
//  - `decimals`: la unidad del producto es medible (admite fracciones).
//  - `takenCodes`: los códigos que ya usan otros en la sucursal, con la clave en
//    minúscula y recortada, y el nombre del dueño como valor. Tiene que incluir el
//    código del propio producto y dejar fuera las presentaciones que se están editando.
export function validateDrafts(
  drafts: PresentationDraft[],
  opts: { productName: string; decimals: boolean; soldLoose: boolean; takenCodes: Map<string, string> },
): string | null {
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();

  for (const draft of drafts) {
    const name = draft.name.trim();
    if (name === '') return 'La presentación necesita un nombre.';

    const { units, price } = draft;
    if (units === '' || !Number.isFinite(units) || units <= 1) {
      return 'Una presentación tiene que traer más de una unidad.';
    }
    if (!opts.decimals && !Number.isInteger(units)) {
      return `«${opts.productName}» se cuenta por piezas: la presentación tiene que traer una cantidad entera.`;
    }
    if (price === '' || !Number.isFinite(price) || price < 0) {
      return 'El precio de la presentación no puede ser negativo.';
    }

    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) return `Ya hay una presentación llamada «${name}» en este producto.`;
    seenNames.add(nameKey);

    const code = draft.code.trim();
    if (code !== '') {
      const codeKey = code.toLowerCase();
      // Otra presentación del mismo producto es del propio producto: el dueño es él.
      const owner = opts.takenCodes.get(codeKey) ?? (seenCodes.has(codeKey) ? opts.productName : undefined);
      if (owner !== undefined) return `El código «${code}» ya lo usa «${owner}» en esta sucursal.`;
      seenCodes.add(codeKey);
    }
  }

  if (!opts.soldLoose && drafts.length === 0) {
    return `Si «${opts.productName}» no se vende suelto, necesita al menos una presentación.`;
  }
  return null;
}

// ---------- CSV ----------

// presentacion_1, contiene_1, precio_1, codigo_1 … hasta la 3.
export const PRESENTATION_CSV_HEADERS: readonly string[] = Array.from({ length: CSV_SLOTS }, (_, i) => [
  `presentacion_${i + 1}`,
  `contiene_${i + 1}`,
  `precio_${i + 1}`,
  `codigo_${i + 1}`,
]).flat();

// Lee hasta 3 presentaciones de una fila. Un grupo con todo vacío se salta; uno a
// medias da un solo error (el primero que le falte: nombre, unidades, precio) y no
// tumba a los demás. Solo revisa que estén completos: los rangos (más de una unidad,
// entero, precio no negativo) los valida `validateDrafts`. `parseNum` es el lector de
// números del CSV: vacío o ilegible = undefined.
export function parsePresentationColumns(
  get: (key: string) => string | undefined,
  parseNum: (raw?: string) => number | undefined,
): { presentations: PresentationInput[]; errors: string[] } {
  const presentations: PresentationInput[] = [];
  const errors: string[] = [];

  for (let i = 1; i <= CSV_SLOTS; i++) {
    const name = (get(`presentacion_${i}`) ?? '').trim();
    const unitsRaw = (get(`contiene_${i}`) ?? '').trim();
    const priceRaw = (get(`precio_${i}`) ?? '').trim();
    const code = (get(`codigo_${i}`) ?? '').trim();
    if (name === '' && unitsRaw === '' && priceRaw === '' && code === '') continue;

    if (name === '') {
      errors.push(`Presentación ${i}: falta el nombre.`);
      continue;
    }
    if (unitsRaw === '') {
      errors.push(`Presentación ${i}: falta cuántas unidades trae.`);
      continue;
    }
    const units = parseNum(unitsRaw);
    if (units === undefined) {
      errors.push(`Presentación ${i}: cuántas unidades trae no es un número válido.`);
      continue;
    }
    if (priceRaw === '') {
      errors.push(`Presentación ${i}: falta el precio.`);
      continue;
    }
    const price = parseNum(priceRaw);
    if (price === undefined) {
      errors.push(`Presentación ${i}: el precio no es un número válido.`);
      continue;
    }

    presentations.push(code === '' ? { name, units, price } : { name, units, price, code });
  }

  return { presentations, errors };
}

// Rangos de las presentaciones que leyó `parsePresentationColumns` (más de una unidad,
// entera si la unidad es contable, precio no negativo, nombres sin repetir), con los
// mismos textos que el formulario y la base. Primer error o null. No revisa códigos
// contra la sucursal (`takenCodes` vacío): ahí manda la base, que rechaza el lote
// completo; sí detecta el mismo código dos veces dentro de la fila. Tampoco exige
// presentaciones: eso depende de si la fila actualiza un producto que ya las tiene
// (ver `csvSoldLooseError`).
export function validatePresentationInputs(
  inputs: PresentationInput[],
  opts: { productName: string; decimals: boolean },
): string | null {
  return validateDrafts(
    inputs.map((p) => ({ name: p.name, units: p.units, price: p.price, code: p.code ?? '' })),
    { productName: opts.productName, decimals: opts.decimals, soldLoose: true, takenCodes: new Map() },
  );
}

// Fila del CSV con `se_vende_suelto = no` y sin presentaciones: el mismo error que
// `save_product_presentations`. No es error si la fila actualiza un producto que ya
// tiene presentaciones: la importación nunca borra, así que seguirán ahí. Una celda
// vacía (`soldLoose` undefined) no cambia nada y tampoco es error.
export function csvSoldLooseError(
  row: { name: string; soldLoose?: boolean; presentations: readonly unknown[] },
  existing?: { presentations?: readonly unknown[] },
): string | null {
  if (row.soldLoose !== false || row.presentations.length > 0) return null;
  if ((existing?.presentations?.length ?? 0) > 0) return null;
  return validateDrafts([], {
    productName: row.name,
    decimals: true,
    soldLoose: false,
    takenCodes: new Map(),
  });
}

// Las 3 primeras presentaciones (de menor a mayor) como columnas del CSV; las que
// faltan quedan vacías. Siempre trae las 12 claves de `PRESENTATION_CSV_HEADERS`.
export function presentationColumns(product: Product): Record<string, string> {
  const columns: Record<string, string> = {};
  const list = presentationsOf(product);
  for (let i = 0; i < CSV_SLOTS; i++) {
    const p = list[i];
    columns[`presentacion_${i + 1}`] = p ? p.name : '';
    columns[`contiene_${i + 1}`] = p ? num(p.units) : '';
    columns[`precio_${i + 1}`] = p ? String(Math.round(p.price * 100) / 100) : '';
    columns[`codigo_${i + 1}`] = p?.code ?? '';
  }
  return columns;
}

// ---------- Cotización → POS ----------

// Qué hacer con una línea cotizada al cargarla en el POS. Con la presentación que
// sigue existiendo (se busca por id), devuelve la ACTUAL, con su precio de hoy. Si
// ya no existe, si trae otra cantidad de unidades que cuando se cotizó (el precio
// cotizado era el de otra caja) o si el producto ya no se vende suelto, `missing`
// dice qué falta.
export function resolveQuotedPresentation(
  quoted: LinePresentation | undefined,
  product: Product,
): { presentation?: ProductPresentation; missing?: string } {
  if (!quoted) {
    return isSoldLoose(product) ? {} : { missing: `${product.name} (ya no se vende suelto)` };
  }
  const current = quoted.id ? (product.presentations ?? []).find((p) => p.id === quoted.id) : undefined;
  if (!current) return { missing: `${quoted.name} de ${product.name} (la presentación ya no existe)` };
  if (round3(current.units) !== round3(quoted.units)) {
    return { missing: `${quoted.name} de ${product.name} (la presentación cambió)` };
  }
  return { presentation: current };
}
