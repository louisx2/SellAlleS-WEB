import type { Sale } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { formatQtyCompact } from '@/lib/units';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/lib/supabase/client';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  financing: 'Financiamiento',
};

export function buildSaleReceiptText(sale: Sale, companyName?: string): string {
  const title = companyName ? companyName.toUpperCase() : 'SELLALLES POS';
  const dateStr = format(new Date(sale.createdAt), "dd/MM/yyyy h:mm a", { locale: es });
  const customerName = sale.customer?.name || 'Consumidor Final';
  const methodLabel = PAYMENT_METHOD_LABELS[sale.paymentMethod] || sale.paymentMethod;

  let text = `🧾 *COMPROBANTE DE COMPRA*\n`;
  text += `*${title}*\n`;
  if (sale.ncf) text += `NCF: ${sale.ncf}\n`;
  text += `Fecha: ${dateStr}\n`;
  text += `Cliente: ${customerName}\n`;
  text += `----------------------------------------\n`;
  text += `*DETALLE DE PRODUCTOS:*\n`;

  sale.items.forEach((item) => {
    const unitPrice = item.customPrice ?? item.product.price;
    const itemTotal = unitPrice * item.quantity;
    text += `• ${item.product.name}\n  ${formatQtyCompact(item.quantity, item.product.unit)} x ${formatCurrency(unitPrice)} = ${formatCurrency(itemTotal)}\n`;
  });

  text += `----------------------------------------\n`;
  text += `Subtotal: ${formatCurrency(sale.subtotal)}\n`;
  if (sale.itbisAmount > 0) {
    text += `ITBIS (18%): ${formatCurrency(sale.itbisAmount)}\n`;
  }
  text += `*TOTAL A PAGAR: ${formatCurrency(sale.total)}*\n`;
  text += `Método de pago: ${methodLabel}\n`;

  if (sale.paymentReference) {
    text += `Referencia: ${sale.paymentReference}\n`;
  }

  if (sale.amountPaid < sale.total && (sale.paymentStatus === 'credit' || sale.paymentStatus === 'in_financing')) {
    const balance = sale.total - sale.amountPaid;
    text += `Abono Inicial: ${formatCurrency(sale.amountPaid)}\n`;
    text += `*Pendiente por Pagar: ${formatCurrency(balance)}*\n`;
  }

  text += `----------------------------------------\n`;
  text += `¡Gracias por su preferencia!`;

  return text;
}

/** Normaliza el teléfono del cliente al formato que espera WhatsApp. */
function telefonoParaWhatsApp(sale: Sale): string {
  let phone = sale.customer?.phone ? sale.customer.phone.replace(/\D/g, '') : '';
  if (phone.length === 10 && (phone.startsWith('809') || phone.startsWith('829') || phone.startsWith('849'))) {
    phone = '1' + phone;
  }
  return phone;
}

function urlDeWhatsApp(text: string, phone: string) {
  return phone
    ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}

/**
 * Abre WhatsApp. Si se le pasa una pestaña ya abierta, la reutiliza en vez de
 * abrir otra: ver `abrirPestanaParaWhatsApp`. Devuelve si logró abrirse.
 */
function abrirWhatsApp(text: string, phone: string, ventana?: Window | null): boolean {
  const url = urlDeWhatsApp(text, phone);
  if (ventana && !ventana.closed) {
    ventana.location.href = url;
    return true;
  }
  return window.open(url, '_blank') !== null;
}

/** Teléfono o tableta: sin ratón, la pantalla es táctil. */
function esTactil(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches === true;
}

/**
 * Abre una pestaña en blanco para llenarla después con el enlace de WhatsApp.
 *
 * En el escritorio hace falta: el navegador solo deja abrir ventanas mientras
 * dura el clic del usuario (en Chrome, unos 5 segundos), y generar el PDF y
 * subirlo tarda más que eso, así que un `window.open` al final se bloquea.
 *
 * En el teléfono NO se abre nada por adelantado, y esto es importante: Chrome
 * para Android salta a la pestaña nueva al instante, deja el POS en segundo
 * plano y congela lo que quedó a medias. En el log del servidor se veía llegar
 * el preflight y el POST no salía nunca — el cajero solo veía "Failed to send a
 * request to the Edge Function". Ahí el enlace se abre con el botón del final,
 * que es un toque del usuario y no necesita permiso de ventanas emergentes.
 *
 * Llamar SIN await, como primera línea del manejador del clic.
 */
export function abrirPestanaParaWhatsApp(): Window | null {
  if (esTactil()) return null;
  return window.open('', '_blank');
}

export function shareSaleViaWhatsApp(sale: Sale, companyName?: string) {
  abrirWhatsApp(buildSaleReceiptText(sale, companyName), telefonoParaWhatsApp(sale));
}

/** base64 -> Blob PDF, para poder subirlo como archivo en vez de como texto. */
function base64APdf(base64: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Sube el PDF y abre WhatsApp con un enlace de descarga temporal.
 *
 * WhatsApp no deja adjuntar un archivo desde un enlace `wa.me`, así que la
 * alternativa anterior obligaba al cajero a descargar el PDF y adjuntarlo a
 * mano. Con el enlace el mensaje sale de una vez.
 *
 * El enlace es firmado y vence: una factura lleva datos del cliente y no debe
 * quedar accesible para siempre a quien la reenvíe.
 */
export async function shareSalePdfLinkViaWhatsApp(
  saleId: string,
  pdfBase64: string,
  sale: Sale,
  companyName?: string,
  ventana?: Window | null,
): Promise<{ url: string; diasValidez: number; abrioWhatsApp: boolean }> {
  // El PDF NO viaja dentro del JSON de la función: por ahí no cabía y la
  // petición ni siquiera llegaba ("Failed to send a request to the Edge
  // Function"). La función entrega URLs firmadas y el archivo va directo a
  // Storage.
  //
  // La caja se queda abierta horas sin recargar y el token vence: la función
  // respondía 401 "Sesión inválida" y el cajero no entendía por qué. getSession
  // renueva el token si hace falta, y si ya no hay sesión lo dice claro.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Tu sesión expiró. Vuelve a entrar y repite el envío.');

  // Son dos llamadas y el orden no es negociable: Storage no firma la descarga
  // de un objeto que todavía no existe (responde "Object not found"), así que
  // primero se pide el permiso de subida, se sube, y recién ahí se pide el
  // enlace.
  const subida = await llamarReceiptLink({ saleId });
  const { ruta, uploadToken } = subida as { ruta: string; uploadToken: string };

  const { error: upErr } = await supabase.storage
    .from('comprobantes')
    .uploadToSignedUrl(ruta, uploadToken, base64APdf(pdfBase64), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) throw new Error(`No se pudo guardar el PDF: ${upErr.message}`);

  const enlace = await llamarReceiptLink({ saleId, paso: 'enlace' });
  const { url, diasValidez } = enlace as { url: string; diasValidez: number };

  const abrioWhatsApp = abrirWhatsApp(
    mensajeConEnlace(url, diasValidez, companyName),
    telefonoParaWhatsApp(sale),
    ventana,
  );
  return { url, diasValidez, abrioWhatsApp };
}

function mensajeConEnlace(url: string, diasValidez: number, companyName?: string) {
  const negocio = companyName ?? 'nuestro negocio';
  return (
    `¡Gracias por su compra en ${negocio}!\n\n` +
    `Aquí puede descargar su comprobante en PDF:\n${url}\n\n` +
    `El enlace estará disponible por ${diasValidez} días.`
  );
}

/** Reintento manual: el enlace ya está generado y solo falta abrir el chat.
 *  Sirve cuando el navegador bloqueó la pestaña la primera vez. */
export function abrirWhatsAppConEnlace(
  sale: Sale,
  url: string,
  diasValidez: number,
  companyName?: string,
) {
  abrirWhatsApp(mensajeConEnlace(url, diasValidez, companyName), telefonoParaWhatsApp(sale));
}

/** Llama a la Edge Function y desenreda los dos sitios donde puede venir el
 *  error: el transporte (`error`) y el cuerpo de la respuesta (`data.error`). */
async function llamarReceiptLink(body: { saleId: string; paso?: 'enlace' }) {
  const { data, error } = await supabase.functions.invoke('receipt-link', { body });
  const msg = (data as { error?: string } | null)?.error ?? error?.message;
  if (msg) throw new Error(msg);
  if (!data) throw new Error('La función no devolvió respuesta.');
  return data as Record<string, unknown>;
}

/** Tamaño real del recibo en milímetros, tomado de lo que se ve en pantalla.
 *
 *  Los formatos varían por empresa (ticket de 58 mm, de 80 mm, o una factura
 *  ancha), así que en vez de asumir uno se mide el elemento y se convierte a mm
 *  con los 96 dpi que usa CSS. Así el PDF sale a la medida sin que nadie tenga
 *  que configurar nada, y si mañana aparece otro formato, funciona igual. */
function medidasDelRecibo(element: HTMLElement, canvas: HTMLCanvasElement) {
  const PX_A_MM = 25.4 / 96;
  const anchoPx = element.offsetWidth || canvas.width;
  // Si por lo que sea el ancho medido es absurdo, se cae a 80 mm (el estándar
  // de las térmicas) antes que generar un PDF de tamaño inválido.
  const anchoMm = anchoPx > 0 ? anchoPx * PX_A_MM : 80;
  const anchoFinal = Math.min(Math.max(anchoMm, 40), 300);
  return {
    anchoMm: anchoFinal,
    // El alto respeta la proporción del render: sin deformar y sin recortar.
    altoMm: (canvas.height * anchoFinal) / canvas.width,
  };
}

/** Rasteriza el recibo y arma el PDF a su medida.
 *
 *  Lo comparten el envío y la descarga: antes cada uno hacía su propia versión
 *  y salían distintas — al cliente le llegaba una y el cajero se descargaba
 *  otra, estirada a A4.
 *
 *  scale 3: el recibo mide unos 100 mm de ancho, así que a menos resolución el
 *  texto sale suave al ampliarlo en el teléfono o al imprimirlo. */
async function renderizarRecibo(element: HTMLElement) {
  const jsPDF = (await import('jspdf')).default;
  const html2canvas = (await import('html2canvas')).default;

  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.9);
  const { anchoMm, altoMm } = medidasDelRecibo(element, canvas);

  // Página a la medida exacta del recibo, en vez de A4. Forzar 210 mm estiraba
  // un ticket de 80 mm hasta casi el triple: se veía ampliado y borroso, y
  // partido en varias páginas. Con el formato derivado del propio elemento
  // funciona igual para 58 mm, 80 mm o una factura ancha, sin ajustes.
  const pdf = new jsPDF({
    orientation: altoMm >= anchoMm ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [anchoMm, altoMm],
  });

  pdf.addImage(imgData, 'JPEG', 0, 0, anchoMm, altoMm);
  return pdf;
}

export async function generateReceiptPdf(element: HTMLElement, filename: string): Promise<string> {
  const pdf = await renderizarRecibo(element);
  return pdf.output('datauristring').split(',')[1];
}

export async function downloadReceiptPdfFile(element: HTMLElement, filename: string) {
  // Antes forzaba A4 y paginaba: el recibo quedaba estirado a 210 mm de ancho
  // y con media hoja en blanco debajo. Ahora sale igual que el que recibe el
  // cliente, a la medida del recibo y en una sola página.
  const pdf = await renderizarRecibo(element);
  pdf.save(filename);
}

export async function sendReceiptViaResendEmail(
  saleId: string,
  email: string,
  pdfBase64: string,
  filename: string,
  sale?: Sale,
  companyName?: string
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-sale-receipt', {
    body: {
      saleId,
      email,
      pdfBase64,
      filename,
    },
  });

  if (error) {
    throw new Error(error?.message || 'Error al enviar el correo.');
  }

  if (data?.error) {
    throw new Error(data.error);
  }
}
