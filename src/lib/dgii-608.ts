// Formato 608 de DGII (comprobantes anulados, Norma 07-2018).
// Catálogo oficial de motivos y generación del TXT de envío. El orden de los
// 3 campos vive en UN solo lugar (buildDetailFields) para poder corregirlo
// barato si el pre-validador de DGII exige un ajuste.
//
// Aquí van los NCF quemados SIN efecto (deterioro, errores de impresión o
// digitación, cese...). Las ventas anuladas con Nota de Crédito B04 NO se
// reportan en el 608: van en el 607 junto a su nota de crédito.

import type { VoidedNcf } from '@/lib/types';

// Casilla 3: tipo de anulación.
export const VOID_REASONS_608: { code: string; label: string }[] = [
  { code: '01', label: '01 - Deterioro de factura pre-impresa' },
  { code: '02', label: '02 - Errores de impresión (factura pre-impresa)' },
  { code: '03', label: '03 - Impresión defectuosa' },
  { code: '04', label: '04 - Corrección de la información' },
  { code: '05', label: '05 - Cambio de productos' },
  { code: '06', label: '06 - Devolución de productos' },
  { code: '07', label: '07 - Omisión de productos' },
  { code: '08', label: '08 - Errores en secuencias de NCF' },
  { code: '09', label: '09 - Por cese de operaciones' },
];

const digitsOnly = (s?: string) => (s ?? '').replace(/\D/g, '');
const fmtDate = (iso?: string) => (iso ? iso.replaceAll('-', '') : ''); // yyyy-mm-dd → AAAAMMDD

// Encabezados de las 3 columnas, para el preview y el CSV de revisión.
export const DGII_608_HEADERS = ['NCF', 'Fecha Anulación', 'Tipo de Anulación'];

export const buildDetailFields = (row: VoidedNcf): string[] => [
  row.ncf.trim(),             // 1  NCF anulado
  fmtDate(row.voidedDate),    // 2  Fecha de anulación AAAAMMDD
  row.reasonCode,             // 3  Tipo de anulación (01-09)
];

/** TXT de envío: cabecera `608|RNC|AAAAMM|cantidad` + un detalle por línea,
 *  separado por pipes, CRLF, sin BOM (formato de la herramienta DGII). */
export const build608Txt = (companyRnc: string, period: string, rows: VoidedNcf[]): string => {
  const header = ['608', digitsOnly(companyRnc), period.replace('-', ''), String(rows.length)].join('|');
  const lines = rows.map((r) => buildDetailFields(r).join('|'));
  return [header, ...lines].join('\r\n');
};

export const dgii608FileName = (companyRnc: string, period: string) =>
  `DGII_F_608_${digitsOnly(companyRnc)}_${period.replace('-', '')}.txt`;

/** Descarga el TXT plano (sin BOM: el pre-validador de DGII espera ASCII). */
export const download608Txt = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Validación ligera del NCF a registrar: serie B/E + tipo (2 dígitos) +
// secuencia. La palabra final la tiene el pre-validador de DGII.
export const isValidNcfFormat = (ncf: string): boolean =>
  /^[BE]\d{2}\d{8,10}$/i.test(ncf.trim());
