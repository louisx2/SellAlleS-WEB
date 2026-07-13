import Papa from 'papaparse';
import type { Product, ProductCategory, ProductLocation, Supplier } from '@/lib/types';

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
  'ubicacion',
  'precio_mayoreo',
  'cant_min_mayoreo',
  'imagen_url',
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
  locationName?: string;
  wholesalePrice?: number;
  wholesaleMinQuantity?: number;
  imageUrl?: string;
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

function parseBool(raw: string | undefined): boolean {
  const s = norm(String(raw ?? ''));
  return ['si', 'sí', 's', 'true', '1', 'x', 'yes', 'y'].includes(s);
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
            stock: stock ?? 0,
            locationName: cleanStr(g('ubicacion')) || undefined,
            wholesalePrice: wholesalePrice,
            wholesaleMinQuantity: wholesaleMinQuantity,
            imageUrl: cleanStr(g('imagen_url')) || undefined,
            errors,
          };
        });
        resolve(rows);
      },
      error: (err: unknown) => reject(err),
    });
  });
}

/** CSV de plantilla con una fila de ejemplo. */
export function buildTemplateCsv(): string {
  const example: Record<string, string> = {
    codigo: 'ABC123',
    nombre: 'Camisa polo',
    descripcion: 'Talla M, azul',
    categoria: 'Ropa',
    proveedor: 'Textiles SRL',
    costo: '350',
    precio: '650',
    itbis: 'si',
    existencias: '20',
    ubicacion: 'Almacén A',
    precio_mayoreo: '550',
    cant_min_mayoreo: '6',
    imagen_url: '',
  };
  return Papa.unparse({ fields: [...CSV_HEADERS], data: [example] });
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
    existencias: String(p.stock ?? 0),
    ubicacion: p.locationId ? locName.get(p.locationId) ?? '' : '',
    precio_mayoreo: p.wholesalePrice != null ? String(p.wholesalePrice) : '',
    cant_min_mayoreo: p.wholesaleMinQuantity != null ? String(p.wholesaleMinQuantity) : '',
    imagen_url: p.image && /^(https?:|data:)/i.test(p.image) ? p.image : '',
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
