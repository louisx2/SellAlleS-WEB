import type { Sale } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';


/** Qué se está compartiendo. Venta y préstamo siguen exactamente el mismo
 *  camino (PDF a Storage → enlace corto → WhatsApp); lo único que cambia es a
 *  qué apunta el enlace y qué dice el mensaje. */
export type TipoComprobante = 'venta' | 'prestamo';

/** Normaliza el teléfono del cliente al formato que espera WhatsApp. */
function telefonoParaWhatsApp(phone?: string | null): string {
  let limpio = phone ? phone.replace(/\D/g, '') : '';
  if (limpio.length === 10 && (limpio.startsWith('809') || limpio.startsWith('829') || limpio.startsWith('849'))) {
    limpio = '1' + limpio;
  }
  return limpio;
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

/**
 * Deja un texto en la forma que admite el enlace del comprobante:
 * `sellalles.com/<esto>/c/7Kq2Wp`.
 *
 * Tiene que dar el mismo resultado que la función `slug` de la Edge Function
 * receipt-link, que es la que arma el enlace de verdad. Aquí se usa para dos
 * cosas: limpiar lo que el usuario escribe en la pantalla de la empresa, y
 * enseñarle cómo va a quedar antes de guardar.
 */
export function slugParaEnlace(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
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
 * El enlace es firmado y vence: una factura —y más aún el comprobante de un
 * préstamo, que lleva el cronograma completo— tiene datos del cliente y no debe
 * quedar accesible para siempre a quien la reenvíe.
 */
export async function compartirPdfPorWhatsApp(opts: {
  tipo: TipoComprobante;
  id: string;
  pdfBase64: string;
  telefono?: string | null;
  companyName?: string;
  ventana?: Window | null;
}): Promise<{ url: string; diasValidez: number; abrioWhatsApp: boolean }> {
  const { tipo, id, pdfBase64, telefono, companyName, ventana } = opts;
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
  const destino = tipo === 'venta' ? { saleId: id } : { loanId: id };
  const subida = await llamarReceiptLink(destino);
  const { ruta, uploadToken } = subida as { ruta: string; uploadToken: string };

  const { error: upErr } = await supabase.storage
    .from('comprobantes')
    .uploadToSignedUrl(ruta, uploadToken, base64APdf(pdfBase64), {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) throw new Error(`No se pudo guardar el PDF: ${upErr.message}`);

  const enlace = await llamarReceiptLink({ ...destino, paso: 'enlace' });
  const { url, diasValidez } = enlace as { url: string; diasValidez: number };

  const abrioWhatsApp = abrirWhatsApp(
    mensajeConEnlace(tipo, url, diasValidez, companyName),
    telefonoParaWhatsApp(telefono),
    ventana,
  );
  return { url, diasValidez, abrioWhatsApp };
}

function mensajeConEnlace(tipo: TipoComprobante, url: string, diasValidez: number, companyName?: string) {
  const negocio = companyName ?? 'nuestro negocio';
  // A quien recibe un préstamo no se le da las gracias por una compra: el
  // comprobante que se le manda es su contrato con el calendario de cuotas.
  const saludo = tipo === 'venta'
    ? `¡Gracias por su compra en ${negocio}!\n\nAquí puede descargar su comprobante en PDF:`
    : `Comprobante de su préstamo con ${negocio}.\n\nAquí puede descargarlo en PDF, con el calendario de sus cuotas:`;
  return `${saludo}\n${url}\n\nEl enlace estará disponible por ${diasValidez} días.`;
}

/** Reintento manual: el enlace ya está generado y solo falta abrir el chat.
 *  Sirve cuando el navegador bloqueó la pestaña la primera vez. */
export function abrirWhatsAppConEnlace(opts: {
  tipo: TipoComprobante;
  telefono?: string | null;
  url: string;
  diasValidez: number;
  companyName?: string;
}) {
  abrirWhatsApp(
    mensajeConEnlace(opts.tipo, opts.url, opts.diasValidez, opts.companyName),
    telefonoParaWhatsApp(opts.telefono),
  );
}

/** Llama a la Edge Function y desenreda los dos sitios donde puede venir el
 *  error: el transporte (`error`) y el cuerpo de la respuesta (`data.error`). */
async function llamarReceiptLink(body: { saleId?: string; loanId?: string; paso?: 'enlace' }) {
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

/** Correo del comprobante del préstamo. Función aparte de la de ventas porque
 *  el cuerpo del mensaje no se parece: monto prestado, cuota y vencimiento en
 *  lugar de total facturado y NCF. */
export async function sendLoanReceiptViaResendEmail(
  loanId: string,
  email: string,
  pdfBase64: string,
  filename: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-loan-receipt', {
    body: { loanId, email, pdfBase64, filename },
  });

  if (error) throw new Error(error?.message || 'Error al enviar el correo.');
  if (data?.error) throw new Error(data.error);
}
