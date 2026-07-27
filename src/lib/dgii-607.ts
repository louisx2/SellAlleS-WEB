// Formato 607 de DGII (ventas de bienes y servicios, Norma 07-2018).
// Catálogos oficiales y generación del TXT de envío. El orden de los 23
// campos vive en UN solo lugar (buildSaleFields / buildCreditNoteFields)
// para poder corregirlo barato si el pre-validador de DGII exige un ajuste.
//
// El 607 reporta las ventas con NCF Y las notas de crédito (B04) del período,
// ambas con montos en positivo: DGII las neta por el tipo de comprobante.
// Por eso las ventas anuladas NO se excluyen — van junto a su nota de crédito.

import { format } from 'date-fns';
import type { CreditNote, Sale } from '@/lib/types';

// Casilla 5: tipo de ingreso. Las ventas del POS son siempre '01'; el
// catálogo completo queda para cuando otra fuente de ingresos lo necesite.
export const INCOME_TYPES_607: { code: string; label: string }[] = [
  { code: '01', label: '01 - Ingresos por operaciones (no financieros)' },
  { code: '02', label: '02 - Ingresos financieros' },
  { code: '03', label: '03 - Ingresos extraordinarios' },
  { code: '04', label: '04 - Ingresos por arrendamientos' },
  { code: '05', label: '05 - Ingresos por venta de activo depreciable' },
  { code: '06', label: '06 - Otros ingresos' },
];

const digitsOnly = (s?: string) => (s ?? '').replace(/\D/g, '');
const fmtAmount = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);
const fmtDate = (d?: Date) => (d ? format(d, 'yyyyMMdd') : '');

export type Dgii607Row = {
  id: string;
  kind: 'sale' | 'credit_note';
  customerName?: string;
  subtotal: number;
  itbis: number;
  total: number;
  date: Date;
  /** Los 23 campos del detalle, ya formateados y en orden. */
  fields: string[];
};

export type Dgii607Excluded = {
  id: string;
  kind: 'sale' | 'credit_note';
  customerName?: string;
  total: number;
  date: Date;
  reason: string;
};

// Encabezados de las 23 columnas, para el preview y el CSV de revisión.
export const DGII_607_HEADERS = [
  'RNC/Cédula', 'Tipo Id', 'NCF', 'NCF Modificado', 'Tipo de Ingreso',
  'Fecha Comprobante', 'Fecha Retención', 'Monto Facturado', 'ITBIS Facturado',
  'ITBIS Retenido por Terceros', 'ITBIS Percibido', 'Retención Renta por Terceros',
  'ISR Percibido', 'Impuesto Selectivo', 'Otros Impuestos', 'Propina Legal',
  'Efectivo', 'Cheque/Transferencia', 'Tarjeta', 'Venta a Crédito',
  'Bonos/Certificados', 'Permuta', 'Otras Formas',
];

// Identificación del cliente (casillas 1-2): vacías en ventas de consumo sin documento.
const idFields = (rnc: string): [string, string] => {
  const hasId = rnc.length === 9 || rnc.length === 11;
  return hasId ? [rnc, rnc.length === 9 ? '1' : '2'] : ['', ''];
};

// Desglose de cómo se cobró la venta (casillas 17-23). La suma de las 7
// casillas debe dar el total con ITBIS: en ventas a crédito/financiadas el
// inicial va a su método de cobro y el balance a "Venta a Crédito".
const paymentBreakdown = (sale: Sale): { cash: number; transfer: number; card: number; credit: number } => {
  const out = { cash: 0, transfer: 0, card: 0, credit: 0 };
  const isCredit = sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing';
  if (!isCredit) {
    if (sale.paymentMethod === 'transfer') out.transfer = sale.total;
    else if (sale.paymentMethod === 'card') out.card = sale.total;
    else out.cash = sale.total;
    return out;
  }
  const down = Math.min(Math.max(sale.amountPaid, 0), sale.total);
  if (down > 0) {
    if (sale.downPaymentMethod === 'transfer') out.transfer = down;
    else if (sale.downPaymentMethod === 'card') out.card = down;
    else out.cash = down;
  }
  out.credit = sale.total - down;
  return out;
};

const buildSaleFields = (sale: Sale): string[] => {
  const [rnc, tipoId] = idFields(digitsOnly(sale.customer?.rnc));
  const pay = paymentBreakdown(sale);
  return [
    rnc,                                            // 1  RNC o Cédula del cliente
    tipoId,                                         // 2  1=RNC, 2=Cédula
    sale.ncf?.trim() ?? '',                         // 3  NCF
    '',                                             // 4  NCF modificado (solo notas de crédito/débito)
    '01',                                           // 5  Tipo de ingreso: operaciones
    fmtDate(sale.createdAt),                        // 6  Fecha comprobante AAAAMMDD
    '',                                             // 7  Fecha retención (no aplica en POS)
    fmtAmount(sale.subtotal),                       // 8  Monto facturado (sin ITBIS)
    fmtAmount(sale.itbisAmount),                    // 9  ITBIS facturado
    '0.00',                                         // 10 ITBIS retenido por terceros
    '0.00',                                         // 11 ITBIS percibido (régimen no vigente)
    '0.00',                                         // 12 Retención renta por terceros
    '0.00',                                         // 13 ISR percibido (régimen no vigente)
    '0.00',                                         // 14 Impuesto selectivo al consumo
    '0.00',                                         // 15 Otros impuestos/tasas
    '0.00',                                         // 16 Monto propina legal
    fmtAmount(pay.cash),                            // 17 Efectivo
    fmtAmount(pay.transfer),                        // 18 Cheque / Transferencia / Depósito
    fmtAmount(pay.card),                            // 19 Tarjeta débito/crédito
    fmtAmount(pay.credit),                          // 20 Venta a crédito
    '0.00',                                         // 21 Bonos o certificados de regalo
    '0.00',                                         // 22 Permuta
    '0.00',                                         // 23 Otras formas de venta
  ];
};

const buildCreditNoteFields = (note: CreditNote): string[] => {
  const [rnc, tipoId] = idFields(digitsOnly(note.customerRnc));
  // La devolución del dinero va en la casilla del método con que se devolvió.
  const cash = note.refundMethod === 'cash' || !note.refundMethod ? note.total : 0;
  const transfer = note.refundMethod === 'transfer' ? note.total : 0;
  const card = note.refundMethod === 'card' ? note.total : 0;
  return [
    rnc,                                            // 1  RNC o Cédula del cliente
    tipoId,                                         // 2  1=RNC, 2=Cédula
    note.ncf?.trim() ?? '',                         // 3  NCF de la nota de crédito (B04)
    note.ncfModified?.trim() ?? '',                 // 4  NCF de la venta que modifica
    '01',                                           // 5  Tipo de ingreso: operaciones
    fmtDate(note.createdAt),                        // 6  Fecha comprobante AAAAMMDD
    '',                                             // 7  Fecha retención
    fmtAmount(note.subtotal),                       // 8  Monto facturado (sin ITBIS)
    fmtAmount(note.itbisAmount),                    // 9  ITBIS facturado
    '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', // 10-16
    fmtAmount(cash),                                // 17 Efectivo
    fmtAmount(transfer),                            // 18 Cheque / Transferencia / Depósito
    fmtAmount(card),                                // 19 Tarjeta débito/crédito
    '0.00',                                         // 20 Venta a crédito
    '0.00', '0.00', '0.00',                         // 21-23
  ];
};

/** Separa ventas y notas de crédito del período en filas válidas para el 607
 *  y excluidas (con motivo, para el preview en vez de omitirlas en silencio). */
export const classify607 = (
  sales: Sale[],
  creditNotes: CreditNote[] = []
): { rows: Dgii607Row[]; excluded: Dgii607Excluded[] } => {
  const rows: Dgii607Row[] = [];
  const excluded: Dgii607Excluded[] = [];

  for (const sale of sales) {
    const base = {
      id: sale.id, kind: 'sale' as const, customerName: sale.customer?.name,
      total: sale.total, date: sale.createdAt,
    };
    const rnc = digitsOnly(sale.customer?.rnc);
    // B01, B15 y B14 identifican al comprador: exigen RNC/cédula válido.
    const requiresId = sale.ncfType === 'fiscal' || sale.ncfType === 'gubernamental' || sale.ncfType === 'regimen_especial';
    if (!sale.ncf?.trim()) {
      excluded.push({ ...base, reason: 'Sin NCF: no se reporta en el 607.' });
    } else if (requiresId && rnc.length !== 9 && rnc.length !== 11) {
      excluded.push({ ...base, reason: 'El tipo de comprobante (B01/B15/B14) exige RNC (9 dígitos) o cédula (11 dígitos) válido del cliente.' });
    } else {
      rows.push({ ...base, subtotal: sale.subtotal, itbis: sale.itbisAmount, fields: buildSaleFields(sale) });
    }
  }

  for (const note of creditNotes) {
    const base = {
      id: note.id, kind: 'credit_note' as const, customerName: note.customerName,
      total: note.total, date: note.createdAt,
    };
    if (!note.ncf?.trim()) {
      excluded.push({ ...base, reason: 'Nota de crédito sin NCF (la venta original no llevaba comprobante): no se reporta.' });
    } else {
      rows.push({ ...base, subtotal: note.subtotal, itbis: note.itbisAmount, fields: buildCreditNoteFields(note) });
    }
  }

  return { rows, excluded };
};

/** TXT de envío: cabecera `607|RNC|AAAAMM|cantidad` + un detalle por línea,
 *  separado por pipes, CRLF, sin BOM (formato de la herramienta DGII). */
export const build607Txt = (companyRnc: string, period: string, rows: Dgii607Row[]): string => {
  const header = ['607', digitsOnly(companyRnc), period.replace('-', ''), String(rows.length)].join('|');
  const lines = rows.map((r) => r.fields.join('|'));
  return [header, ...lines].join('\r\n');
};

export const dgii607FileName = (companyRnc: string, period: string) =>
  `DGII_F_607_${digitsOnly(companyRnc)}_${period.replace('-', '')}.txt`;

/** Descarga el TXT plano (sin BOM: el pre-validador de DGII espera ASCII). */
export const download607Txt = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
