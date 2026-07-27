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

export function shareSaleViaWhatsApp(sale: Sale, companyName?: string) {
  const text = buildSaleReceiptText(sale, companyName);
  let phone = sale.customer?.phone ? sale.customer.phone.replace(/\D/g, '') : '';

  if (phone) {
    if (phone.length === 10 && (phone.startsWith('809') || phone.startsWith('829') || phone.startsWith('849'))) {
      phone = '1' + phone;
    }
  }

  const url = phone
    ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  window.open(url, '_blank');
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

export async function generateReceiptPdf(element: HTMLElement, filename: string): Promise<string> {
  const jsPDF = (await import('jspdf')).default;
  const html2canvas = (await import('html2canvas')).default;

  const canvas = await html2canvas(element, {
    scale: 1.5,
    useCORS: true,
  });
  
  const imgData = canvas.toDataURL('image/jpeg', 0.8);
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

  return pdf.output('datauristring').split(',')[1];
}

export async function downloadReceiptPdfFile(element: HTMLElement, filename: string) {
  const jsPDF = (await import('jspdf')).default;
  const html2canvas = (await import('html2canvas')).default;

  const canvas = await html2canvas(element, {
    scale: 1.5,
    useCORS: true,
  });
  
  const imgData = canvas.toDataURL('image/jpeg', 0.8);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const imgWidth = 210;
  const pageHeight = 297;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft >= 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

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
