// Correos de suscripción que manda el super admin desde el panel: la factura
// de un pago y el aviso de un comprobante rechazado. Salen por
// send-lifecycle-email, que es quien deduplica (clave única en
// platform_email_log) y respeta el tope diario.

import { supabase } from '@/lib/supabase/client';
import type { SubscriptionPayment } from '@/lib/types';
import {
  METODO_DE_PAGO, codigoDeFactura, nombreArchivoFactura, facturaEnBase64,
} from '@/lib/subscription-invoice';
import type { ReportePago } from '@/lib/payment-reports';

export interface Destinatario { name: string | null; email: string }

/** El primer administrador activo con correo de la empresa. */
export async function adminDeEmpresa(companyId: string): Promise<Destinatario | null> {
  const { data: admins } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .not('email', 'is', null)
    .order('created_at')
    .limit(1);
  const admin = admins?.[0];
  return admin?.email ? { name: admin.name ?? null, email: admin.email as string } : null;
}

async function invocar(body: Record<string, unknown>, destino: Destinatario): Promise<string> {
  const { data, error } = await supabase.functions.invoke('send-lifecycle-email', { body });
  const respuesta = data as { error?: string; skipped?: string } | null;
  const msg = respuesta?.error ?? error?.message;
  if (msg) throw new Error(msg);
  if (respuesta?.skipped === 'correo_rebotado') {
    throw new Error(`Los correos a ${destino.email} rebotan; no se le vuelve a escribir.`);
  }
  return destino.email;
}

/**
 * Manda la factura al administrador de la empresa y devuelve a qué dirección.
 * La clave del registro es el id del pago, así que el mismo pago no sale dos
 * veces aunque la llamada se repita; el reenvío manual lleva la hora para que
 * sí salga cada vez que se pide.
 */
export async function enviarFactura(
  company: { id: string; name: string },
  pago: SubscriptionPayment,
  reenvio = false,
): Promise<string> {
  const destino = await adminDeEmpresa(company.id);
  if (!destino) throw new Error('La empresa no tiene un administrador activo con correo.');

  // Si el PDF fallara, el correo sale igual, como recibo y sin adjunto: la
  // empresa se entera del pago y la factura sigue en su Mi Suscripción.
  let attachment: { filename: string; content: string } | undefined;
  if (pago.invoiceNumber != null) {
    try {
      attachment = { filename: nombreArchivoFactura(pago), content: await facturaEnBase64(pago) };
    } catch (err) {
      console.error('No se pudo armar el PDF de la factura:', err);
    }
  }

  return invocar({
    template: 'recibo-suscripcion',
    to: destino.email,
    companyId: company.id,
    dedupeKey: reenvio
      ? `${company.id}:pago:${pago.id}:reenvio:${Date.now()}`
      : `${company.id}:pago:${pago.id}`,
    attachment,
    vars: {
      companyName: company.name,
      userName: destino.name,
      amount: pago.amount,
      method: METODO_DE_PAGO[pago.method] ?? pago.method,
      paidAt: pago.paidAt,
      paidUntil: pago.periodEnd ?? null,
      invoiceNumber: pago.invoiceNumber != null ? codigoDeFactura(pago) : null,
    },
  }, destino);
}

/** Le dice a la empresa que su comprobante no se pudo confirmar, y por qué. */
export async function avisarPagoRechazado(
  company: { id: string; name: string },
  reporte: ReportePago,
  motivo: string,
): Promise<string> {
  const destino = await adminDeEmpresa(company.id);
  if (!destino) throw new Error('La empresa no tiene un administrador activo con correo.');
  return invocar({
    template: 'pago-rechazado',
    to: destino.email,
    companyId: company.id,
    dedupeKey: `${company.id}:comprobante-rechazado:${reporte.id}`,
    vars: {
      companyName: company.name,
      userName: destino.name,
      amount: reporte.amount,
      paidAt: reporte.paidAt,
      reason: motivo,
    },
  }, destino);
}
