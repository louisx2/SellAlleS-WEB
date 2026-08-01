// Lo mínimo para abrirle a alguien un chat de WhatsApp con el mensaje escrito.
//
// Vivía dentro de receipt-sharing.ts, que es donde nació. Salió de ahí cuando la
// ruta de cobro necesitó lo mismo para recordarle una cuota a un cliente: el
// arreglo del teléfono dominicano no tiene nada que ver con comprobantes y
// duplicarlo era pedir que las dos copias se separaran.

/** Normaliza el teléfono al formato que espera WhatsApp.
 *
 *  Los números de RD se guardan como 809/829/849 y sin país; WhatsApp los
 *  necesita con el 1 delante o abre un chat vacío. */
export function telefonoParaWhatsApp(phone?: string | null): string {
  let limpio = phone ? phone.replace(/\D/g, '') : '';
  if (limpio.length === 10 && (limpio.startsWith('809') || limpio.startsWith('829') || limpio.startsWith('849'))) {
    limpio = '1' + limpio;
  }
  return limpio;
}

/** Sin teléfono el enlace sigue sirviendo: WhatsApp abre con el mensaje listo y
 *  deja elegir el destinatario a mano. */
export function urlDeWhatsApp(text: string, phone: string): string {
  return phone
    ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}

/**
 * Abre WhatsApp. Si se le pasa una pestaña ya abierta, la reutiliza en vez de
 * abrir otra: ver `abrirPestanaParaWhatsApp` en receipt-sharing.
 * Devuelve si logró abrirse.
 */
export function abrirWhatsApp(text: string, phone: string, ventana?: Window | null): boolean {
  const url = urlDeWhatsApp(text, phone);
  if (ventana && !ventana.closed) {
    ventana.location.href = url;
    return true;
  }
  return window.open(url, '_blank') !== null;
}
