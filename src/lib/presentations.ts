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

// Un código tal como lo compara la base: recortado y en minúscula ('' = sin código).
const codeKey = (code?: string) => (code ?? '').trim().toLowerCase();

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

// Lo que vende un código: el producto suelto o una de sus presentaciones.
export type CodeMatch = { product: Product; presentation?: ProductPresentation };
// El código lleva a más de un destino y alguno es una presentación (producto y
// presentación, o dos presentaciones): no se puede saber cuál es.
export type AmbiguousCode = { ambiguous: true; matches: CodeMatch[] };

// Búsqueda por código escrito o escaneado, sin distinguir mayúsculas ni espacios en
// los bordes. La base no deja que el código de una presentación choque con otro,
// pero el de un producto sí puede terminar igual al de una presentación (se cambió
// después, se restauró un archivado, llegó por una transferencia): entonces no se
// elige ninguno, porque cobrar el que salga primero sería cobrar mal sin avisar.
// Si solo hay productos con ese código (un problema de datos anterior a las
// presentaciones), sigue como siempre: el primero de la lista.
export function findByCode(code: string, products: Product[]): CodeMatch | AmbiguousCode | undefined {
  const needle = codeKey(code);
  if (needle === '') return undefined;

  const matches: CodeMatch[] = [];
  for (const product of products) {
    if (codeKey(product.code) === needle) matches.push({ product });
    for (const presentation of product.presentations ?? []) {
      if (codeKey(presentation.code) === needle) matches.push({ product, presentation });
    }
  }
  if (matches.length === 0) return undefined;
  if (matches.length === 1 || matches.every((m) => m.presentation === undefined)) return matches[0];
  return { ambiguous: true, matches };
}

// Lo que dice el POS cuando el código está repetido.
export function duplicateCodeMessage(code: string): string {
  return `El código «${code.trim()}» está repetido en esta sucursal; corrígelo en Inventario.`;
}

// ¿Hay un código más largo (de producto o de presentación) que empieza por `term`?
// Sin distinguir mayúsculas ni espacios en los bordes. El lector de mano teclea un
// carácter a la vez: con GAL-001 y GAL-001-12, al llegar a «GAL-001» todavía puede
// venir más, y el POS no debe agregar la unidad suelta por adelantado.
export function isPrefixOfLongerCode(term: string, products: Product[]): boolean {
  const needle = codeKey(term);
  if (needle === '') return false;
  const longer = (code?: string) => {
    const key = codeKey(code);
    return key.length > needle.length && key.startsWith(needle);
  };
  return products.some((p) => longer(p.code) || (p.presentations ?? []).some((x) => longer(x.code)));
}

// Código del producto en el formulario: no puede ser el de una presentación de otro
// producto de la sucursal (el escaneo no sabría cuál es). Dos productos con el mismo
// código siguen permitidos, como antes de las presentaciones. `selfId` es el producto
// que se edita (ausente al crear): sus presentaciones las revisa `validateDrafts`
// contra este mismo código. Primer error o null.
export function productCodeError(
  code: string,
  selfId: string | undefined,
  products: readonly CsvCodeOwner[],
): string | null {
  const key = codeKey(code);
  if (key === '') return null;
  const shown = code.trim();
  const others = products.filter((p) => p.id !== selfId);

  for (const p of others) {
    const presentation = (p.presentations ?? []).find((x) => codeKey(x.code) === key);
    if (presentation) {
      return `El código «${shown}» ya lo usa la presentación «${presentation.name}» de «${p.name}» en esta sucursal.`;
    }
  }
  return null;
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

// Un producto que ya está en la sucursal, para comprobar códigos (CSV y formulario).
export interface CsvCodeOwner {
  id: string;
  name: string;
  code?: string;
  presentations?: readonly { name: string; code?: string }[];
}

// Una fila del CSV que se va a importar, tal como quedará: `code` es el código con el que
// quedará el producto (el de la fila, o el nuevo si se crea con código nuevo) y
// `updatesId` es el producto existente que actualiza (ausente si crea uno nuevo).
export interface CsvCodeEntry {
  rowNumber: number;
  name: string;
  code: string;
  presentations: readonly PresentationInput[];
  updatesId?: string;
}

// El `codigo` de la fila (el del producto) contra las presentaciones: las de las
// OTRAS filas del archivo y las de los demás productos de la sucursal (las del
// producto que la fila actualiza las revisa el chequeo de presentaciones). Primer
// choque o null.
function csvProductCodeError(
  entry: CsvCodeEntry,
  entries: readonly CsvCodeEntry[],
  existing: readonly CsvCodeOwner[],
): string | null {
  const key = codeKey(entry.code);
  if (key === '') return null;
  const shown = entry.code.trim();

  for (const other of entries) {
    if (other === entry) continue;
    const p = other.presentations.find((x) => codeKey(x.code) === key);
    if (p) {
      return `El código «${shown}» ya lo usa la presentación «${p.name}» de la fila ${other.rowNumber} («${other.name}») del archivo.`;
    }
  }
  for (const product of existing) {
    if (product.id === entry.updatesId) continue;
    const p = (product.presentations ?? []).find((x) => codeKey(x.code) === key);
    if (p) return `El código «${shown}» ya lo usa la presentación «${p.name}» de «${product.name}» en esta sucursal.`;
  }
  return null;
}

// Códigos que chocarían al importar, por número de fila (el primer choque de cada
// fila). `import_product_presentations` es un solo lote: si la base rechaza un
// código, deshace TODAS las presentaciones del archivo, así que conviene atajarlo
// antes, fila por fila. Se comparan recortados y en minúscula, como la base.
//  - En el archivo: el código de una presentación no puede ser el `codigo` de otro
//    producto del archivo (esté antes o después) ni repetir el de una presentación de
//    una fila anterior. Si choca con el `codigo` de otra fila se marcan las dos (no se
//    sabe cuál está mal), cada una nombrando a la otra.
//  - En la sucursal: ni el código de un producto existente (también el del propio
//    producto: el trigger lo prohíbe) ni el de una presentación existente, con los
//    textos de la base. Una fila que actualiza un producto puede repetir las
//    presentaciones suyas que trae (se emparejan por nombre), no las demás.
//  - El `codigo` del producto tampoco puede ser el de una presentación de otro
//    producto de la sucursal: la base solo vigila las presentaciones, y el escaneo
//    no sabría cuál de los dos es (ver `findByCode`). Vale también para las filas
//    sin presentaciones y para las que actualizan.
// Las filas ya tienen que haber pasado `validatePresentationInputs`. Una fila marcada
// no se queda con sus códigos de presentación, porque no se va a importar. Los
// productos archivados no se conocen aquí: ahí la base sigue siendo la última palabra.
export function csvPresentationCodeErrors(
  entries: readonly CsvCodeEntry[],
  existing: readonly CsvCodeOwner[],
): Map<number, string> {
  const errors = new Map<number, string>();
  const claimed = new Map<string, { rowNumber: number; name: string }>();

  for (const entry of entries) {
    if (entry.presentations.every((p) => codeKey(p.code) === '')) {
      const error = csvProductCodeError(entry, entries, existing);
      if (error !== null) errors.set(entry.rowNumber, error);
      continue;
    }

    let error: string | null = null;
    for (const p of entry.presentations) {
      const key = codeKey(p.code);
      if (key === '') continue;
      const shown = (p.code ?? '').trim();
      const owner = entries.find((other) => other !== entry && codeKey(other.code) === key);
      if (owner) {
        error = `El código «${shown}» de la presentación «${p.name}» es el código del producto de la fila ${owner.rowNumber} («${owner.name}») del archivo.`;
        break;
      }
      const earlier = claimed.get(key);
      if (earlier) {
        error = `El código «${shown}» de la presentación «${p.name}» ya lo usa la fila ${earlier.rowNumber} («${earlier.name}») del archivo.`;
        break;
      }
    }

    if (error === null) {
      const takenCodes = new Map<string, string>();
      const take = (code: string | undefined, owner: string) => {
        const key = codeKey(code);
        if (key !== '' && !takenCodes.has(key)) takenCodes.set(key, owner);
      };
      const rewritten = new Set(entry.presentations.map((p) => p.name.trim().toLowerCase()));
      for (const product of existing) {
        take(product.code, product.name);
        for (const p of product.presentations ?? []) {
          if (product.id === entry.updatesId && rewritten.has(p.name.trim().toLowerCase())) continue;
          take(p.code, product.name);
        }
      }
      take(entry.code, entry.name);

      error = validateDrafts(
        entry.presentations.map((p) => ({ name: p.name, units: p.units, price: p.price, code: p.code ?? '' })),
        // Los rangos ya los revisó el parser: aquí solo importan los códigos.
        { productName: entry.name, decimals: true, soldLoose: true, takenCodes },
      );
    }

    if (error === null) error = csvProductCodeError(entry, entries, existing);

    if (error !== null) {
      errors.set(entry.rowNumber, error);
      continue;
    }
    for (const p of entry.presentations) {
      const key = codeKey(p.code);
      if (key !== '' && !claimed.has(key)) claimed.set(key, { rowNumber: entry.rowNumber, name: entry.name });
    }
  }
  return errors;
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
