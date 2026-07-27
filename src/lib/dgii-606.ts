// Formato 606 de DGII (compras de bienes y servicios, Norma 07-2018).
// Catálogos oficiales y generación del TXT de envío. El orden de los 23
// campos vive en UN solo lugar (buildInvoiceFields / buildExpenseFields)
// para poder corregirlo barato si el pre-validador de DGII exige un ajuste.
//
// Al 606 entran las facturas de Cuentas por Pagar Y los gastos con datos
// fiscales (NCF + RNC del suplidor): combustible, dieta, compras menores, etc.

import { format } from 'date-fns';
import type { Expense, PaymentMethod, SupplierInvoice } from '@/lib/types';

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
const fmtDateIso = (iso?: string) => (iso ? iso.replaceAll('-', '') : ''); // yyyy-mm-dd → AAAAMMDD
const fmtDate = (d?: Date) => (d ? format(d, 'yyyyMMdd') : '');

// Cómo entra una factura al 606 de un período (criterio "retención al pagar"):
//  - full: emitida Y pagada en el período → fila completa (base + retención).
//  - base_only: emitida en el período pero aún no pagada (o pagada en otro mes)
//    → base sin retención; la retención esperará al mes del pago.
//  - retention_only: pagada en este período pero emitida en otro → solo la
//    retención; la base ya se reportó en el mes de emisión.
export type InvoiceMode = 'full' | 'base_only' | 'retention_only';

export type Dgii606Row = {
  id: string;
  kind: 'invoice' | 'expense';
  supplierName?: string;
  /** Base sin ITBIS (bienes + servicios). */
  subtotal: number;
  itbis: number;
  retenido: number;
  total: number;
  /** Presente en facturas: cómo entra al 606 del período. */
  mode?: InvoiceMode;
  /** Los 23 campos del detalle, ya formateados y en orden. */
  fields: string[];
};

export type Dgii606Excluded = {
  id: string;
  kind: 'invoice' | 'expense';
  supplierName?: string;
  total: number;
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

// Criterio "retención al pagar": la base (casillas 8-11, 13-15, 20-22) va en
// el período de emisión; las retenciones (12 ITBIS, 17/18 ISR) en el período
// del pago. Según el modo, se ponen en cero las casillas que no correspondan.
const buildInvoiceFields = (inv: SupplierInvoice, mode: InvoiceMode): string[] => {
  const rnc = digitsOnly(inv.supplier?.rnc);
  const tipoId = rnc.length === 9 ? '1' : '2';
  const withBase = mode === 'full' || mode === 'base_only';
  const withRet = mode === 'full' || mode === 'retention_only';
  const base = (n: number) => fmtAmount(withBase ? n : 0);
  const ret = (n: number) => fmtAmount(withRet ? n : 0);
  const itbisPorAdelantar = Math.max(inv.itbisFacturado - inv.itbisLlevadoCosto, 0);
  return [
    rnc,                                            // 1  RNC o Cédula del suplidor
    tipoId,                                         // 2  1=RNC, 2=Cédula
    inv.expenseType ?? '',                          // 3  Tipo bienes/servicios (01-11)
    digitsOnly(inv.ncf) ? inv.ncf!.trim() : '',     // 4  NCF
    inv.ncfModified?.trim() ?? '',                  // 5  NCF o documento modificado
    fmtDateIso(inv.issueDate),                      // 6  Fecha comprobante AAAAMMDD
    fmtDateIso(inv.paymentDate),                    // 7  Fecha pago (vacío si impaga)
    base(inv.subtotalServices),                     // 8  Monto facturado servicios
    base(inv.subtotalGoods),                        // 9  Monto facturado bienes
    base(inv.subtotalServices + inv.subtotalGoods), // 10 Total facturado
    base(inv.itbisFacturado),                       // 11 ITBIS facturado
    ret(inv.itbisRetenido),                         // 12 ITBIS retenido (período del pago)
    base(inv.itbisProporcionalidad),                // 13 ITBIS sujeto a proporcionalidad (Art. 349)
    base(inv.itbisLlevadoCosto),                    // 14 ITBIS llevado al costo
    base(itbisPorAdelantar),                        // 15 ITBIS por adelantar
    '0.00',                                         // 16 ITBIS percibido en compras (régimen no vigente)
    withRet ? (inv.isrRetentionType ?? '') : '',    // 17 Tipo retención ISR (01-08, período del pago)
    ret(inv.isrRetentionAmount),                    // 18 Monto retención renta (período del pago)
    '0.00',                                         // 19 ISR percibido en compras (régimen no vigente)
    base(inv.impuestoSelectivo),                    // 20 Impuesto selectivo al consumo
    base(inv.otrosImpuestos),                       // 21 Otros impuestos/tasas
    base(inv.propinaLegal),                         // 22 Monto propina legal
    inv.paymentForm ?? '04',                        // 23 Forma de pago (01-07)
  ];
};

// Un gasto fiscal es un comprobante simple: sin retenciones ni impuestos
// especiales. La base es amount - itbis; bienes o servicios según isGoods.
const buildExpenseFields = (e: Expense): string[] => {
  const rnc = digitsOnly(e.rnc);
  const tipoId = rnc.length === 9 ? '1' : '2';
  const base = Math.max(e.amount - e.itbisAmount, 0);
  return [
    rnc,                                            // 1  RNC o Cédula del suplidor
    tipoId,                                         // 2  1=RNC, 2=Cédula
    e.expenseType ?? '',                            // 3  Tipo bienes/servicios (01-11)
    e.ncf?.trim() ?? '',                            // 4  NCF
    '',                                             // 5  NCF o documento modificado
    fmtDate(e.date),                                // 6  Fecha comprobante AAAAMMDD
    fmtDate(e.date),                                // 7  Fecha pago (el gasto se paga al registrarse)
    fmtAmount(e.isGoods ? 0 : base),                // 8  Monto facturado servicios
    fmtAmount(e.isGoods ? base : 0),                // 9  Monto facturado bienes
    fmtAmount(base),                                // 10 Total facturado
    fmtAmount(e.itbisAmount),                       // 11 ITBIS facturado
    '0.00',                                         // 12 ITBIS retenido
    '0.00',                                         // 13 ITBIS proporcionalidad
    '0.00',                                         // 14 ITBIS llevado al costo
    fmtAmount(e.itbisAmount),                       // 15 ITBIS por adelantar
    '0.00',                                         // 16 ITBIS percibido
    '',                                             // 17 Tipo retención ISR
    '0.00',                                         // 18 Retención renta
    '0.00',                                         // 19 ISR percibido
    '0.00',                                         // 20 Impuesto selectivo
    '0.00',                                         // 21 Otros impuestos
    '0.00',                                         // 22 Propina legal
    e.paymentForm ?? '01',                          // 23 Forma de pago (01-07)
  ];
};

/** Separa facturas y gastos fiscales en filas válidas para el 606 del período
 *  y excluidas (con motivo). Los gastos SIN NCF ni se muestran: son gastos
 *  informales que no aplican al 606.
 *
 *  `period` (yyyy-mm) activa el criterio "retención al pagar": la base se
 *  reporta en el mes de emisión y la retención en el mes del pago. Las
 *  facturas ya deben venir pre-filtradas por (emisión ∈ período O pago ∈
 *  período). Sin `period` (''), toda factura entra completa (compat). */
export const classify606 = (
  invoices: SupplierInvoice[],
  expenses: Expense[] = [],
  period = ''
): { rows: Dgii606Row[]; excluded: Dgii606Excluded[] } => {
  const rows: Dgii606Row[] = [];
  const excluded: Dgii606Excluded[] = [];

  for (const inv of invoices) {
    const base = {
      id: inv.id, kind: 'invoice' as const, supplierName: inv.supplier?.name, total: inv.total,
    };
    const rnc = digitsOnly(inv.supplier?.rnc);
    const retencion = inv.itbisRetenido + inv.isrRetentionAmount;
    if (!inv.ncf?.trim()) {
      excluded.push({ ...base, reason: 'Sin NCF: no se reporta en el 606.' });
      continue;
    }
    if (rnc.length !== 9 && rnc.length !== 11) {
      excluded.push({ ...base, reason: 'El suplidor no tiene un RNC (9 dígitos) o cédula (11 dígitos) válido.' });
      continue;
    }
    if (!inv.expenseType) {
      excluded.push({ ...base, reason: 'Falta el tipo de bienes/servicios (casilla 3).' });
      continue;
    }

    // ¿En qué modo entra esta factura al 606 del período?
    const issuedInPeriod = !period || (inv.issueDate ?? '').startsWith(period);
    const paidInPeriod = !!inv.paymentDate && inv.paymentDate.startsWith(period);
    let mode: InvoiceMode;
    if (!period || (issuedInPeriod && paidInPeriod)) {
      mode = 'full';
    } else if (issuedInPeriod) {
      mode = 'base_only';       // emitida este mes; su retención espera al mes del pago
    } else if (paidInPeriod && retencion > 0.005) {
      mode = 'retention_only';  // pagada este mes; la base ya se reportó al emitirse
    } else {
      continue;                 // pagada este mes pero sin retención: nada que reportar aquí
    }

    const withBase = mode === 'full' || mode === 'base_only';
    const withRet = mode === 'full' || mode === 'retention_only';
    rows.push({
      ...base,
      mode,
      subtotal: withBase ? inv.subtotalGoods + inv.subtotalServices : 0,
      itbis: withBase ? inv.itbisFacturado : 0,
      retenido: withRet ? retencion : 0,
      fields: buildInvoiceFields(inv, mode),
    });
  }

  for (const e of expenses) {
    if (!e.ncf?.trim()) continue; // gasto informal: no aplica al 606
    const base = {
      id: e.id, kind: 'expense' as const, supplierName: e.description, total: e.amount,
    };
    const rnc = digitsOnly(e.rnc);
    if (rnc.length !== 9 && rnc.length !== 11) {
      excluded.push({ ...base, reason: 'El gasto tiene NCF pero le falta un RNC (9 dígitos) o cédula (11 dígitos) válido.' });
    } else if (!e.expenseType) {
      excluded.push({ ...base, reason: 'Falta el tipo de bienes/servicios (casilla 3).' });
    } else {
      rows.push({
        ...base,
        subtotal: Math.max(e.amount - e.itbisAmount, 0),
        itbis: e.itbisAmount,
        retenido: 0,
        fields: buildExpenseFields(e),
      });
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
