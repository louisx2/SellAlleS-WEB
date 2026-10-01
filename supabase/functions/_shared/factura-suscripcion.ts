// Factura de un pago de suscripción, dibujada desde cero con el texto de jsPDF.
//
// Vive en supabase/functions/_shared para que haya UN solo dibujo: lo usan el panel del super admin y la
// página Mi Suscripción de SellAlleS (src/lib/subscription-invoice.ts) y la Edge Function cobro-externo, que
// le entrega el PDF a Anadsll. Por eso no importa nada: jsPDF llega como parámetro (Next lo carga con
// import('jspdf'), Deno con npm:jspdf) y los tipos son locales. Sin imports de alias ni de Deno.
//
// El PDF sale del pago y de los datos que la base congeló al emitirlo. El texto queda nítido a cualquier
// zoom, se puede copiar, y el archivo pesa unos pocos KB. Como todo sale de la fila, todos llegan a la misma
// factura, hoy o dentro de un año.

export type MetodoDePago = 'transfer' | 'cash' | 'card' | 'other';

export interface FacturaEmisor {
  legalName: string;
  rnc?: string;
  address?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface FacturaCliente {
  name: string;
  rnc?: string;
  address?: string;
  phone?: string;
  email?: string;
}

/** Lo que el dibujo necesita de un pago (SubscriptionPayment de la app cumple esta forma). */
export interface PagoConFactura {
  id: string;
  amount: number;
  paidAt: string;
  method: MetodoDePago;
  reference?: string;
  periodStart?: string;
  periodEnd?: string;
  planName?: string;
  createdAt: Date;
  invoiceNumber?: number;
  invoiceIssuer?: FacturaEmisor;
  invoiceCustomer?: FacturaCliente;
  invoiceItbis: number;
}

/** Lo que se usa de un documento de jsPDF. */
export interface DocPdf {
  internal: { pageSize: { getWidth(): number } };
  setProperties(p: Record<string, string>): unknown;
  setFont(nombre: string, estilo: string): unknown;
  setFontSize(puntos: number): unknown;
  setTextColor(r: number, g: number, b: number): unknown;
  setDrawColor(r: number, g: number, b: number): unknown;
  setFillColor(r: number, g: number, b: number): unknown;
  setLineWidth(ancho: number): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  rect(x: number, y: number, w: number, h: number, estilo?: string): unknown;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, estilo?: string): unknown;
  text(texto: string, x: number, y: number, opciones?: { align?: 'left' | 'center' | 'right' }): unknown;
  splitTextToSize(texto: string, ancho: number): string[];
  save(nombre: string): unknown;
  output(tipo: 'datauristring'): string;
  output(tipo: 'arraybuffer'): ArrayBuffer;
}

export type ConstructorPdf = new (opciones: { unit: 'mm'; format: 'letter' }) => DocPdf;

export const METODO_DE_PAGO: Record<MetodoDePago, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
};

/** Lo que ve el cliente: los 8 primeros caracteres del id del pago. El consecutivo de la base no se imprime:
 *  con una tarifa fija, número × tarifa le diría a cualquier cliente cuánto factura SellAlleS. */
export function codigoDeFactura(p: { id: string }): string {
  return p.id.slice(0, 8).toUpperCase();
}

/** Consecutivo interno, 7 -> "000007". Solo para el panel del super admin. */
export function numeroDeFactura(n: number): string {
  return String(n).padStart(6, '0');
}

export function nombreArchivoFactura(p: { id: string }): string {
  return `factura-sellalles-${codigoDeFactura(p)}.pdf`;
}

/** Una fila de subscription_payments (snake_case, montos como texto) → lo que necesita el dibujo.
 *  Misma traducción que rowToSubscriptionPayment de src/lib/supabase/mappers.ts. */
// deno-lint-ignore no-explicit-any
export function pagoDesdeFila(r: Record<string, any>): PagoConFactura {
  return {
    id: r.id,
    amount: Number(r.amount),
    paidAt: r.paid_at,
    method: r.method,
    reference: r.reference ?? undefined,
    periodStart: r.period_start ?? undefined,
    periodEnd: r.period_end ?? undefined,
    planName: r.plan_name ?? undefined,
    createdAt: new Date(r.created_at),
    invoiceNumber: r.invoice_number ?? undefined,
    invoiceIssuer: r.invoice_issuer
      ? {
          legalName: r.invoice_issuer.legal_name ?? 'SellAlleS',
          rnc: r.invoice_issuer.rnc ?? undefined,
          address: r.invoice_issuer.address ?? undefined,
          phone: r.invoice_issuer.phone ?? undefined,
          email: r.invoice_issuer.email ?? undefined,
          notes: r.invoice_issuer.notes ?? undefined,
        }
      : undefined,
    invoiceCustomer: r.invoice_customer
      ? {
          name: r.invoice_customer.name ?? '',
          rnc: r.invoice_customer.rnc ?? undefined,
          address: r.invoice_customer.address ?? undefined,
          phone: r.invoice_customer.phone ?? undefined,
          email: r.invoice_customer.email ?? undefined,
        }
      : undefined,
    invoiceItbis: Number(r.invoice_itbis ?? 0),
  };
}

// Misma regla que formatPhone y formatCedulaOrRnc de src/lib/format.ts (copiadas: este archivo no importa nada).
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}
function agruparTelefono(valor: string): string {
  const d = soloDigitos(valor).slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join('-');
}
function agruparDocumento(valor: string): string {
  const d = soloDigitos(valor).slice(0, 11);
  if (d.length <= 9) return [d.slice(0, 3), d.slice(3, 8), d.slice(8, 9)].filter(Boolean).join('-');
  return [d.slice(0, 3), d.slice(3, 10), d.slice(10, 11)].filter(Boolean).join('-');
}

/** yyyy-mm-dd -> dd/mm/yyyy, sin pasar por Date: así no hay zona horaria que
 *  corra la fecha un día. */
function fecha(yyyymmdd?: string): string {
  if (!yyyymmdd) return '';
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
}

/** Fecha de emisión: el día en República Dominicana en que se registró el pago,
 *  sin importar la zona del navegador que imprime. */
function fechaDeEmision(creada: Date): string {
  return creada.toLocaleDateString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function dinero(n: number): string {
  return `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "RNC: 131-23456-7" o "Cédula: 001-1234567-8", según la cantidad de dígitos. */
function documento(valor?: string): string | null {
  const digitos = (valor ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  return `${digitos.length === 11 ? 'Cédula' : 'RNC'}: ${agruparDocumento(digitos)}`;
}

/** Los teléfonos de las empresas se guardan como se escribieron ("8095225312");
 *  si es uno dominicano de 10 dígitos se muestra agrupado. */
function telefono(valor?: string): string | undefined {
  if (!valor) return undefined;
  return valor.replace(/\D/g, '').length === 10 ? agruparTelefono(valor) : valor;
}

function descripcion(p: PagoConFactura): string {
  const plan = p.planName?.trim();
  if (!plan) return 'Suscripción SellAlleS';
  // El plan se escribe a mano en el formulario: "Pro" o "Plan Pro".
  return `Suscripción SellAlleS — ${/^plan\b/i.test(plan) ? plan : `Plan ${plan}`}`;
}

function periodo(p: PagoConFactura): string | null {
  if (p.periodStart && p.periodEnd) return `Período: del ${fecha(p.periodStart)} al ${fecha(p.periodEnd)}`;
  if (p.periodEnd) return `Cubre hasta el ${fecha(p.periodEnd)}`;
  return null;
}

type Rgb = [number, number, number];
const COLOR: Record<'marca' | 'texto' | 'tenue' | 'linea' | 'fondo' | 'pagada', Rgb> = {
  marca: [79, 70, 229],   // el índigo de los correos de la plataforma
  texto: [17, 24, 39],
  tenue: [107, 114, 128],
  linea: [229, 231, 235],
  fondo: [243, 244, 246],
  pagada: [5, 150, 105],
};

export function crearFactura(JsPDF: ConstructorPdf, p: PagoConFactura): DocPdf {
  if (p.invoiceNumber == null) throw new Error('Este pago no tiene factura.');

  // Carta y no A4: es el papel que se usa en República Dominicana.
  const doc = new JsPDF({ unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 18;
  const R = W - M;

  const emisor = p.invoiceIssuer ?? { legalName: 'SellAlleS' };
  const cliente = p.invoiceCustomer ?? { name: '' };
  const numero = codigoDeFactura(p);
  const subtotal = Math.round((p.amount - p.invoiceItbis) * 100) / 100;

  doc.setProperties({
    title: `Factura ${numero}`,
    subject: descripcion(p),
    author: emisor.legalName,
    creator: 'SellAlleS',
  });

  const fuente = (estilo: 'normal' | 'bold', puntos: number) => {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(puntos);
  };
  const tinta = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const raya = (y: number) => {
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.3);
    doc.line(M, y, R, y);
  };
  /** Escribe el texto partido al ancho dado y devuelve la y de la línea que sigue. */
  const parrafo = (texto: string, x: number, y: number, ancho: number, interlinea = 4.2) => {
    const lineas = doc.splitTextToSize(texto, ancho);
    lineas.forEach((l, i) => doc.text(l, x, y + i * interlinea));
    return y + lineas.length * interlinea;
  };

  // ── Encabezado: emisor a la izquierda, número y fecha a la derecha ────────
  let y = M + 4;
  fuente('bold', 16);
  tinta(COLOR.marca);
  y = parrafo(emisor.legalName, M, y, 110, 6.5);
  y += 0.5;
  fuente('normal', 9);
  tinta(COLOR.tenue);
  const contactoEmisor = [emisor.phone, emisor.email].filter(Boolean).join('   ·   ');
  for (const linea of [documento(emisor.rnc), emisor.address, contactoEmisor]) {
    if (linea) y = parrafo(linea, M, y, 110);
  }

  let yd = M + 5;
  fuente('bold', 22);
  tinta(COLOR.texto);
  doc.text('FACTURA', R, yd, { align: 'right' });
  yd += 7.5;
  fuente('bold', 11);
  doc.text(`No. ${numero}`, R, yd, { align: 'right' });
  yd += 5.5;
  fuente('normal', 9);
  tinta(COLOR.tenue);
  doc.text(`Fecha: ${fechaDeEmision(p.createdAt)}`, R, yd, { align: 'right' });

  y = Math.max(y, yd) + 6;
  raya(y);
  y += 8;

  // ── Cliente y pago ────────────────────────────────────────────────────────
  const XP = 128;
  fuente('bold', 8);
  tinta(COLOR.tenue);
  doc.text('FACTURADO A', M, y);
  doc.text('PAGO', XP, y);

  let yc = y + 5.5;
  fuente('bold', 11);
  tinta(COLOR.texto);
  yc = parrafo(cliente.name || '—', M, yc, 100, 5);
  fuente('normal', 9);
  for (const linea of [documento(cliente.rnc), cliente.address, telefono(cliente.phone), cliente.email]) {
    if (linea) yc = parrafo(linea, M, yc, 100);
  }

  let yp = y + 5.5;
  const filaPago = (clave: string, valor: string) => {
    fuente('normal', 9);
    tinta(COLOR.tenue);
    doc.text(clave, XP, yp);
    tinta(COLOR.texto);
    const lineas = doc.splitTextToSize(valor, R - XP - 26);
    lineas.forEach((l, i) => doc.text(l, R, yp + i * 4.2, { align: 'right' }));
    yp += Math.max(lineas.length, 1) * 4.2 + 1;
  };
  filaPago('Fecha de pago', fecha(p.paidAt));
  filaPago('Método', METODO_DE_PAGO[p.method] ?? p.method);
  if (p.reference) filaPago('Referencia', p.reference);

  y = Math.max(yc, yp) + 8;

  // ── Detalle ───────────────────────────────────────────────────────────────
  doc.setFillColor(...COLOR.fondo);
  doc.rect(M, y, R - M, 8, 'F');
  fuente('bold', 9);
  tinta(COLOR.texto);
  doc.text('Descripción', M + 3, y + 5.3);
  doc.text('Importe', R - 3, y + 5.3, { align: 'right' });
  y += 14;

  const yFila = y;
  fuente('bold', 10);
  y = parrafo(descripcion(p), M + 3, y, 130, 4.8);
  fuente('normal', 10);
  doc.text(dinero(subtotal), R - 3, yFila, { align: 'right' });
  const textoPeriodo = periodo(p);
  if (textoPeriodo) {
    fuente('normal', 9);
    tinta(COLOR.tenue);
    y = parrafo(textoPeriodo, M + 3, y + 0.5, 130);
  }
  y += 3;
  raya(y);
  y += 8;

  // ── Totales, con el sello de pagada a la izquierda ────────────────────────
  const yTotales = y;
  const XT = R - 72;
  const filaTotal = (clave: string, valor: string) => {
    fuente('normal', 10);
    tinta(COLOR.tenue);
    doc.text(clave, XT, y);
    tinta(COLOR.texto);
    doc.text(valor, R - 3, y, { align: 'right' });
    y += 6;
  };
  if (p.invoiceItbis > 0) {
    filaTotal('Subtotal', dinero(subtotal));
    filaTotal('ITBIS (18%)', dinero(p.invoiceItbis));
  }
  fuente('bold', 12);
  tinta(COLOR.texto);
  doc.text('Total', XT, y + 1);
  doc.text(dinero(p.amount), R - 3, y + 1, { align: 'right' });
  y += 8;

  // Todas las facturas de suscripción nacen de un pago ya recibido.
  doc.setDrawColor(...COLOR.pagada);
  doc.setLineWidth(0.6);
  doc.roundedRect(M + 3, yTotales - 5, 36, 11, 2, 2, 'S');
  fuente('bold', 13);
  tinta(COLOR.pagada);
  doc.text('PAGADA', M + 21, yTotales + 2.4, { align: 'center' });

  // ── Notas del emisor ──────────────────────────────────────────────────────
  if (emisor.notes) {
    y += 6;
    raya(y);
    y += 7;
    fuente('bold', 8);
    tinta(COLOR.tenue);
    doc.text('NOTAS', M, y);
    fuente('normal', 9);
    parrafo(emisor.notes, M, y + 5, R - M);
  }

  return doc;
}
