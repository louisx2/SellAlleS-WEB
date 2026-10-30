import Papa from 'papaparse';
import type { Product, ProductCategory, ProductLocation, Supplier } from '@/lib/types';
import {
  DEFAULT_UNIT_CODE, formatQty, getUnit, normalizeQty, parseUnitInput,
  unitAllowsDecimals, type UnitCode,
} from '@/lib/units';
import {
  PRESENTATION_CSV_HEADERS, isSoldLoose, parsePresentationColumns, presentationColumns,
  validatePresentationInputs, type PresentationInput,
} from '@/lib/presentations';

// Encabezados de la plantilla (en español, en minúscula). El parseo es tolerante:
// acepta mayúsculas/espacios y columnas en cualquier orden.
export const CSV_HEADERS = [
  'codigo',
  'nombre',
  'descripcion',
  'categoria',
  'proveedor',
  'costo',
  'precio',
  'itbis',
  'existencias',
  'unidad',
  'maneja_inventario',
  'ubicacion',
  'precio_mayoreo',
  'cant_min_mayoreo',
  'imagen_url',
  'se_vende_suelto',
  ...PRESENTATION_CSV_HEADERS,
] as const;

export interface ParsedProductRow {
  rowNumber: number; // fila en el archivo (1-based, sin contar encabezado)
  code: string;
  name: string;
  description?: string;
  categoryName?: string;
  supplierName?: string;
  cost: number;
  price: number;
  itbis: boolean;
  stock: number;
  unit: UnitCode;
  tracksStock: boolean;
  locationName?: string;
  wholesalePrice?: number;
  wholesaleMinQuantity?: number;
  imageUrl?: string;
  /** Sí/no explícito de `se_vende_suelto`. undefined = celda vacía o columna ausente:
   *  no cambia nada (en un producto nuevo la base lo deja en «sí»). */
  soldLoose: boolean | undefined;
  /** Hasta 3, ya completas y dentro de rango. La importación nunca borra las que existan. */
  presentations: PresentationInput[];
  errors: string[];
}

const norm = (h: string) => h.trim().toLowerCase();

// "RD$ 1,500.50" -> 1500.5 ; "2,500" -> 2500 ; "850,75" -> 850.75 ; "abc"/"" -> undefined
function parseNumber(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return undefined; // ej. "abc" queda vacío
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, ''); // "1,500.50": coma = miles
  } else if (s.includes(',')) {
    // En RD la coma normal es separador de miles ("2,500"). Solo la tratamos
    // como decimal si NO encaja el patrón de miles (ej. "850,75").
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const YES_VALUES = ['si', 'sí', 's', 'true', '1', 'x', 'yes', 'y'];
const NO_VALUES = ['no', 'n', 'false', '0'];

function parseBool(raw: string | undefined): boolean {
  return YES_VALUES.includes(norm(String(raw ?? '')));
}

// Sí/no explícito con el mismo vocabulario de `itbis`. A diferencia de `parseBool`,
// vacío es "no dice nada" (value undefined) y lo que no es ni sí ni no es `invalid`:
// un typo no debe apagar la venta suelta de un producto sin que nadie lo note.
function parseYesNo(raw: string | undefined): { value: boolean | undefined; invalid: boolean } {
  const s = norm(String(raw ?? ''));
  if (s === '') return { value: undefined, invalid: false };
  if (YES_VALUES.includes(s)) return { value: true, invalid: false };
  if (NO_VALUES.includes(s)) return { value: false, invalid: false };
  return { value: undefined, invalid: true };
}

function cleanStr(raw: string | undefined): string {
  return String(raw ?? '').trim();
}

/** Parsea el CSV en filas tipadas + valida cada una. */
export function parseProductsCsv(text: string): Promise<ParsedProductRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: norm,
      complete: (res) => {
        const rows: ParsedProductRow[] = res.data.map((raw, i) => {
          const g = (k: string) => raw[k];
          const errors: string[] = [];

          const name = cleanStr(g('nombre'));
          if (!name) errors.push('Falta el nombre.');

          const cost = parseNumber(g('costo'));
          const price = parseNumber(g('precio'));
          const stock = parseNumber(g('existencias'));
          if (g('costo') && cost === undefined) errors.push('Costo inválido.');
          if (g('precio') && price === undefined) errors.push('Precio inválido.');
          if (g('existencias') && stock === undefined) errors.push('Existencias inválidas.');

          const wholesalePrice = parseNumber(g('precio_mayoreo'));
          const wholesaleMinQuantity = parseNumber(g('cant_min_mayoreo'));

          // Unidad en blanco o no reconocida cae a la de siempre ('und'). Pero
          // una cantidad fraccionada en unidad contable es error de fila, no
          // redondeo silencioso: un typo en "kg" no debe truncar 12.5 a 12.
          const rawUnit = cleanStr(g('unidad'));
          const unit = parseUnitInput(rawUnit) ?? DEFAULT_UNIT_CODE;
          // Columna ausente o vacía = maneja inventario (lo de siempre); solo
          // un "no" explícito lo apaga.
          const rawTracks = cleanStr(g('maneja_inventario'));
          const tracksStock = rawTracks === '' ? true : parseBool(rawTracks);
          if (tracksStock && stock !== undefined && !unitAllowsDecimals(unit) && !Number.isInteger(stock)) {
            errors.push(`«${getUnit(unit).plural}» no admite decimales: existencias ${stock} no es entera.`);
          }
          if (wholesaleMinQuantity !== undefined && !unitAllowsDecimals(unit) && !Number.isInteger(wholesaleMinQuantity)) {
            errors.push(`«${getUnit(unit).plural}» no admite decimales en la cantidad mínima de mayoreo.`);
          }

          // Presentaciones (paquete, caja…). `existencias` sigue en unidades base. Aquí
          // solo se revisa lo que se ve en la fila; «no se vende suelto» sin
          // presentaciones depende de si el producto ya existe y lo revisa el diálogo
          // (`csvSoldLooseError`). Los códigos los valida la base.
          const looseCell = parseYesNo(g('se_vende_suelto'));
          if (looseCell.invalid) {
            errors.push('«se_vende_suelto» no se entiende: escribe sí o no, o déjalo en blanco.');
          }
          const parsedPresentations = parsePresentationColumns(g, parseNumber);
          errors.push(...parsedPresentations.errors);
          const rangeError = validatePresentationInputs(parsedPresentations.presentations, {
            productName: name,
            decimals: unitAllowsDecimals(unit),
          });
          if (rangeError) errors.push(rangeError);

          return {
            rowNumber: i + 1,
            code: cleanStr(g('codigo')),
            name,
            description: cleanStr(g('descripcion')) || undefined,
            categoryName: cleanStr(g('categoria')) || undefined,
            supplierName: cleanStr(g('proveedor')) || undefined,
            cost: cost ?? 0,
            price: price ?? 0,
            itbis: parseBool(g('itbis')),
            stock: tracksStock ? normalizeQty(stock ?? 0, unit) : 0,
            unit,
            tracksStock,
            locationName: cleanStr(g('ubicacion')) || undefined,
            wholesalePrice: wholesalePrice,
            wholesaleMinQuantity: wholesaleMinQuantity === undefined ? undefined : normalizeQty(wholesaleMinQuantity, unit),
            imageUrl: cleanStr(g('imagen_url')) || undefined,
            soldLoose: looseCell.value,
            presentations: parsedPresentations.presentations,
            errors,
          };
        });
        resolve(rows);
      },
      error: (err: unknown) => reject(err),
    });
  });
}

/** CSV de plantilla con tres filas de ejemplo: una por pieza, otra por peso y otra
 *  con presentaciones (paquete y caja), para que el formato de las columnas `unidad`
 *  y `presentacion_N` se explique solo. */
export function buildTemplateCsv(): string {
  const porPieza: Record<string, string> = {
    codigo: 'ABC123',
    nombre: 'Camisa polo',
    descripcion: 'Talla M, azul',
    categoria: 'Ropa',
    proveedor: 'Textiles SRL',
    costo: '350',
    precio: '650',
    itbis: 'si',
    existencias: '20',
    unidad: 'und',
    maneja_inventario: 'si',
    ubicacion: 'Almacén A',
    precio_mayoreo: '550',
    cant_min_mayoreo: '6',
    imagen_url: '',
    se_vende_suelto: 'si',
  };
  const porPeso: Record<string, string> = {
    codigo: 'FER-CEM',
    nombre: 'Cemento a granel',
    descripcion: 'Usa punto para los decimales',
    categoria: 'Materiales',
    proveedor: '',
    costo: '12',
    precio: '18',
    itbis: 'si',
    existencias: '250.5',
    unidad: 'lb',
    maneja_inventario: 'si',
    ubicacion: '',
    precio_mayoreo: '',
    cant_min_mayoreo: '',
    imagen_url: '',
    se_vende_suelto: 'si',
  };
  // `existencias` va en unidades base: 1250 galletas, no 1250 cajas. Los 12 y los
  // 288 de `contiene_N` también son unidades base.
  const conPresentaciones: Record<string, string> = {
    codigo: 'GAL-001',
    nombre: 'Galletas surtidas',
    descripcion: 'Existencias en unidades, no en cajas',
    categoria: 'Víveres',
    proveedor: '',
    costo: '10',
    precio: '15',
    itbis: 'no',
    existencias: '1250',
    unidad: 'und',
    maneja_inventario: 'si',
    ubicacion: '',
    precio_mayoreo: '',
    cant_min_mayoreo: '',
    imagen_url: '',
    se_vende_suelto: 'si',
    presentacion_1: 'Paquete',
    contiene_1: '12',
    precio_1: '160',
    codigo_1: 'GAL-001-12',
    presentacion_2: 'Caja',
    contiene_2: '288',
    precio_2: '3600',
    codigo_2: 'GAL-001-288',
  };
  return Papa.unparse({ fields: [...CSV_HEADERS], data: [porPieza, porPeso, conPresentaciones] });
}

/** Exporta el catálogo actual a CSV (mismos encabezados que la plantilla). */
export function buildExportCsv(
  products: Product[],
  categories: ProductCategory[],
  suppliers: Supplier[],
  locations: ProductLocation[],
): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const data = products.map((p) => ({
    codigo: p.code ?? '',
    nombre: p.name,
    descripcion: p.description ?? '',
    categoria: p.categoryId ? catName.get(p.categoryId) ?? '' : '',
    proveedor: p.supplierId ? supName.get(p.supplierId) ?? '' : '',
    costo: String(p.cost ?? 0),
    precio: String(p.price ?? 0),
    itbis: p.itbis ? 'si' : 'no',
    // formatQty y no String(): un stock de 12.299999999999999 saldría entero al CSV.
    existencias: formatQty(p.stock ?? 0),
    unidad: p.unit ?? DEFAULT_UNIT_CODE,
    maneja_inventario: (p.tracksStock ?? true) ? 'si' : 'no',
    ubicacion: p.locationId ? locName.get(p.locationId) ?? '' : '',
    precio_mayoreo: p.wholesalePrice != null ? String(p.wholesalePrice) : '',
    cant_min_mayoreo: p.wholesaleMinQuantity != null ? formatQty(p.wholesaleMinQuantity) : '',
    imagen_url: p.image && /^(https?:|data:)/i.test(p.image) ? p.image : '',
    // Igual que itbis: sí/no. Los productos anteriores a las presentaciones se venden sueltos.
    se_vende_suelto: isSoldLoose(p) ? 'si' : 'no',
    // Las 3 más chicas. Si tiene más, las demás se quedan como están: importar nunca borra.
    ...presentationColumns(p),
  }));

  return Papa.unparse({ fields: [...CSV_HEADERS], data });
}

/** Dispara la descarga de un texto como archivo. */
export function downloadTextFile(filename: string, text: string) {
  // BOM para que Excel respete acentos/UTF-8.
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
