// Formato 606 de DGII (compras de bienes y servicios, Norma 07-2018).
// Catálogos oficiales y generación del TXT de envío. El orden de los 23
// campos vive en UN solo lugar (buildDetailFields) para poder corregirlo
// barato si el pre-validador de DGII exige un ajuste.

import type { PaymentMethod, SupplierInvoice } from '@/lib/types';

// Casilla 3: tipo de bienes/servicios comprados.
export const EXPENSE_TYPES_606: { code: string; label: string }[] = [
  { code: '01', label: '01 - Gastos de personal' },
  { code: '02', label: '02 - Gastos por trabajos, suministros y servicios' },
  { code: '03', label: '03 - Arrendamientos' },
  { code: '04', label: '04 - Gastos de activos fijos' },
  { code: '05', label: '05 - Gastos de representación' },
  { code: '06', label: '06 - Otras deducciones admitidas' },
  { code: '07', label: '07 - Gastos financieros' },
  { code: '08', label: '08 - Gastos extraordinarios' },
  { code: '09', label: '09 - Compras y gastos que forman parte del costo de venta' },
  { code: '10', label: '10 - Adquisiciones de activos' },
  { code: '11', label: '11 - Gastos de seguros' },
];

// Casilla 17: tipo de retención en ISR.
export const ISR_RETENTION_TYPES_606: { code: string; label: string }[] = [
  { code: '01', label: '01 - Alquileres' },
  { code: '02', label: '02 - Honorarios por servicios' },
  { code: '03', label: '03 - Otras rentas' },
  { code: '04', label: '04 - Rentas presuntas' },
  { code: '05', label: '05 - Intereses pagados a personas jurídicas' },
  { code: '06', label: '06 - Intereses pagados a personas físicas' },
  { code: '07', label: '07 - Retención por proveedores del Estado' },
  { code: '08', label: '08 - Juegos telefónicos' },
];

// Casilla 23: forma de pago.
export const PAYMENT_FORMS_606: { code: string; label: string }[] = [
  { code: '01', label: '01 - Efectivo' },
  { code: '02', label: '02 - Cheque / Transferencia / Depósito' },
  { code: '03', label: '03 - Tarjeta de crédito / débito' },
  { code: '04', label: '04 - Compra a crédito' },
  { code: '05', label: '05 - Permuta' },
  { code: '06', label: '06 - Nota de crédito' },
  { code: '07', label: '07 - Mixto' },
];

// Forma de pago 606 sugerida a partir de cómo se registró la operación.
export const suggestPaymentForm606 = (isCredit: boolean, method?: PaymentMethod): string => {
  if (isCredit) return '04';
  switch (method) {
    case 'cash': return '01';
    case 'transfer': return '02';
    case 'card': return '03';
    default: return '04';
  }
};

const digitsOnly = (s?: string) => (s ?? '').replace(/\D/g, '');
const fmtAmount = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);
const fmtDate = (iso?: string) => (iso ? iso.replaceAll('-', '') : ''); // yyyy-mm-dd → AAAAMMDD

export type Dgii606Row = {
  invoice: SupplierInvoice;
  /** Los 23 campos del detalle, ya formateados y en orden. */
  fields: string[];
};

export type Dgii606Excluded = {
  invoice: SupplierInvoice;
  reason: string;
};

// Encabezados de las 23 columnas, para el preview y el CSV de revisión.
export const DGII_606_HEADERS = [
  'RNC/Cédula', 'Tipo Id', 'Tipo Bienes/Servicios', 'NCF', 'NCF Modificado',
  'Fecha Comprobante', 'Fecha Pago', 'Monto Servicios', 'Monto Bienes', 'Total Facturado',
  'ITBIS Facturado', 'ITBIS Retenido', 'ITBIS Proporcionalidad', 'ITBIS Llevado al Costo',
  'ITBIS por Adelantar', 'ITBIS Percibido', 'Tipo Retención ISR', 'Retención Renta',
  'ISR Percibido', 'Impuesto Selectivo', 'Otros Impuestos', 'Propina Legal', 'Forma de Pago',
];

const buildDetailFields = (inv: SupplierInvoice): string[] => {
  const rnc = digitsOnly(inv.supplier?.rnc);
  const tipoId = rnc.length === 9 ? '1' : '2';
  const itbisPorAdelantar = Math.max(inv.itbisFacturado - inv.itbisLlevadoCosto, 0);
  return [
    rnc,                                            // 1  RNC o Cédula del suplidor
    tipoId,                                         // 2  1=RNC, 2=Cédula
    inv.expenseType ?? '',                          // 3  Tipo bienes/servicios (01-11)
    digitsOnly(inv.ncf) ? inv.ncf!.trim() : '',     // 4  NCF
    inv.ncfModified?.trim() ?? '',                  // 5  NCF o documento modificado
    fmtDate(inv.issueDate),                         // 6  Fecha comprobante AAAAMMDD
    fmtDate(inv.paymentDate),                       // 7  Fecha pago (vacío si impaga)
    fmtAmount(inv.subtotalServices),                // 8  Monto facturado servicios
    fmtAmount(inv.subtotalGoods),                   // 9  Monto facturado bienes
    fmtAmount(inv.subtotalServices + inv.subtotalGoods), // 10 Total facturado
    fmtAmount(inv.itbisFacturado),                  // 11 ITBIS facturado
    fmtAmount(inv.itbisRetenido),                   // 12 ITBIS retenido
    fmtAmount(inv.itbisProporcionalidad),           // 13 ITBIS sujeto a proporcionalidad (Art. 349)
    fmtAmount(inv.itbisLlevadoCosto),               // 14 ITBIS llevado al costo
    fmtAmount(itbisPorAdelantar),                   // 15 ITBIS por adelantar
    '0.00',                                         // 16 ITBIS percibido en compras (régimen no vigente)
    inv.isrRetentionType ?? '',                     // 17 Tipo retención ISR (01-08)
    fmtAmount(inv.isrRetentionAmount),              // 18 Monto retención renta
    '0.00',                                         // 19 ISR percibido en compras (régimen no vigente)
    fmtAmount(inv.impuestoSelectivo),               // 20 Impuesto selectivo al consumo
    fmtAmount(inv.otrosImpuestos),                  // 21 Otros impuestos/tasas
    fmtAmount(inv.propinaLegal),                    // 22 Monto propina legal
    inv.paymentForm ?? '04',                        // 23 Forma de pago (01-07)
  ];
};

/** Separa las facturas del período en filas válidas para el 606 y excluidas
 *  (con motivo, para mostrarlas en el preview en vez de omitirlas en silencio). */
export const classify606 = (invoices: SupplierInvoice[]): { rows: Dgii606Row[]; excluded: Dgii606Excluded[] } => {
  const rows: Dgii606Row[] = [];
  const excluded: Dgii606Excluded[] = [];
  for (const inv of invoices) {
    const rnc = digitsOnly(inv.supplier?.rnc);
    if (!inv.ncf?.trim()) {
      excluded.push({ invoice: inv, reason: 'Sin NCF: no se reporta en el 606.' });
    } else if (rnc.length !== 9 && rnc.length !== 11) {
      excluded.push({ invoice: inv, reason: 'El suplidor no tiene un RNC (9 dígitos) o cédula (11 dígitos) válido.' });
    } else if (!inv.expenseType) {
      excluded.push({ invoice: inv, reason: 'Falta el tipo de bienes/servicios (casilla 3).' });
    } else {
      rows.push({ invoice: inv, fields: buildDetailFields(inv) });
    }
  }
  return { rows, excluded };
};

/** TXT de envío: cabecera `606|RNC|AAAAMM|cantidad` + un detalle por línea,
 *  separado por pipes, CRLF, sin BOM (formato de la herramienta DGII). */
export const build606Txt = (companyRnc: string, period: string, rows: Dgii606Row[]): string => {
  const header = ['606', digitsOnly(companyRnc), period.replace('-', ''), String(rows.length)].join('|');
  const lines = rows.map((r) => r.fields.join('|'));
  return [header, ...lines].join('\r\n');
};

export const dgii606FileName = (companyRnc: string, period: string) =>
  `DGII_F_606_${digitsOnly(companyRnc)}_${period.replace('-', '')}.txt`;

/** Descarga el TXT plano (sin BOM: el pre-validador de DGII espera ASCII). */
export const download606Txt = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
