// Punto único de envío de los correos transaccionales de la PLATAFORMA
// (bienvenida, prueba por vencer, suspensión, activación, factura de pago).
// No cubre los correos que una empresa manda a SUS clientes; esos siguen en
// send-sale-receipt y compañía.
//
// Todo pasa por aquí para que se cumplan tres cosas que antes no existían:
//   - un mismo aviso no se manda dos veces (clave única en platform_email_log)
//   - no se le escribe a direcciones que rebotaron
//   - se sabe cuántos correos van en el día, contra el tope del plan Free
//
// Las plantillas viven en este archivo y no en el editor de Resend a propósito:
// así quedan versionadas en git, se revisan en un diff y se despliegan junto
// con el código que las usa.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// x-impersonate-company va en la lista porque el cliente la manda en todas sus
// peticiones mientras el super admin está dentro de una empresa (ver
// lib/supabase/client.ts); sin ella el navegador bloquea el POST en el
// preflight y la factura no sale.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-impersonate-company',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

// El plan Free de Resend permite 100 correos al día. Se corta antes del tope
// para dejar aire a lo que no pasa por aquí (auth, recibos de venta): si el
// límite se agota, lo primero que deja de funcionar es la confirmación de
// cuenta de un cliente nuevo, y eso cuesta mucho más que un aviso de prueba.
const TOPE_DIARIO = 80;

type Template =
  | 'bienvenida'
  | 'prueba-por-vencer'
  | 'prueba-vencida'
  | 'cuenta-activada'
  | 'recibo-suscripcion'
  | 'cobro-por-vencer'
  | 'cuota-vencida'
  | 'pago-rechazado'
  | 'comprobante-recibido'
  | 'resumen-cobros';

// Plantillas que recibe el super admin, no una empresa: no llevan el bloque
// de "contáctanos" de soporte, que sería escribirse a sí mismo.
const PARA_LA_PLATAFORMA: Template[] = ['comprobante-recibido', 'resumen-cobros'];

// Dirección de la app para los botones de los correos. Sin ella los correos
// salen sin botón y dicen dónde está cada cosa en palabras.
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');

interface Contacto {
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  whatsappLabel: string | null;
  emailEnabled: boolean;
  email: string | null;
  hours: string | null;
}

function fmtFecha(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoneda(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Bloque de contacto, siempre desde platform_settings: si el super admin
 *  cambia el número o apaga un canal, los correos lo reflejan sin redesplegar. */
function bloqueContacto(c: Contacto): string {
  const partes: string[] = [];
  if (c.whatsappEnabled && c.whatsappNumber) {
    // Sin el número a la vista: el enlace ya lleva al chat correcto, y mostrarlo
    // solo invita a guardarlo o marcarlo por fuera. Si cambia el número, los
    // correos viejos siguen funcionando porque el destino sale de la config.
    partes.push(
      `<a href="https://wa.me/${esc(c.whatsappNumber)}" style="display:inline-block;background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Contáctanos por WhatsApp</a>`,
    );
  }
  if (c.emailEnabled && c.email) {
    partes.push(`<a href="mailto:${esc(c.email)}" style="color:#4F46E5;">${esc(c.email)}</a>`);
  }
  if (!partes.length) return '';
  return `<div style="margin:24px 0;">${partes.join(' &nbsp; ')}${c.hours ? `<p style="font-size:12px;color:#6B7280;margin-top:8px;">${esc(c.hours)}</p>` : ''}</div>`;
}

interface CuentaBancaria { bank?: string; type?: string; number?: string; holder?: string; holderId?: string | null; currency?: string }

/** Las cuentas de SellAlleS para transferir, tal como se configuran en la
 *  plataforma. Sin cuentas activas no se muestra nada. */
function bloqueBancos(v: unknown): string {
  const cuentas = Array.isArray(v) ? (v as CuentaBancaria[]) : [];
  if (!cuentas.length) return '';
  const filas = cuentas.map((a) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;"><strong>${esc(a.bank)}</strong><br><span style="color:#6B7280;font-size:12px;">Cuenta de ${esc(a.type === 'corriente' ? 'cheques / corriente' : 'ahorro')}${a.currency && a.currency !== 'DOP' ? ` · ${esc(a.currency)}` : ''}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-family:monospace;font-size:15px;">${esc(a.number)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;">${esc(a.holder)}${a.holderId ? `<br><span style="color:#6B7280;">${esc(a.holderId)}</span>` : ''}</td>
    </tr>`).join('');
  return `
    <p style="margin-top:20px;"><strong>Cuentas para transferir:</strong></p>
    <table style="width:100%;border-collapse:collapse;background:#F9FAFB;border-radius:5px;">${filas}</table>`;
}

function textoBancos(v: unknown): string {
  const cuentas = Array.isArray(v) ? (v as CuentaBancaria[]) : [];
  if (!cuentas.length) return '';
  return '\n\nCuentas para transferir:\n' + cuentas
    .map((a) => `- ${a.bank} (${a.type === 'corriente' ? 'corriente' : 'ahorro'}): ${a.number} a nombre de ${a.holder}${a.holderId ? `, ${a.holderId}` : ''}`)
    .join('\n');
}

function boton(ruta: string, texto: string): string {
  if (!APP_URL) return '';
  return `<p style="margin:24px 0;"><a href="${esc(APP_URL + ruta)}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">${esc(texto)}</a></p>`;
}

const SIN_CONTACTO: Contacto = {
  whatsappEnabled: false, whatsappNumber: null, whatsappLabel: null, emailEnabled: false, email: null, hours: null,
};

function envolver(titulo: string, cuerpo: string, contacto: Contacto): string {
  return `
    <div style="font-family: sans-serif; color:#333; max-width:600px; margin:0 auto; padding:20px; border:1px solid #eee; border-radius:5px;">
      <h2 style="color:#4F46E5; border-bottom:2px solid #F3F4F6; padding-bottom:10px;">${esc(titulo)}</h2>
      ${cuerpo}
      ${bloqueContacto(contacto)}
      <p style="font-size:12px;color:#9CA3AF;margin-top:28px;">Este mensaje lo envía la plataforma SellAlleS.</p>
    </div>`;
}

interface Render { subject: string; html: string; text: string; }

function render(template: Template, vars: Record<string, unknown>, c: Contacto, conAdjunto: boolean): Render {
  const empresa = esc(vars.companyName ?? 'tu empresa');
  const nombre = vars.userName ? ` ${esc(vars.userName)}` : '';

  switch (template) {
    case 'bienvenida':
      return {
        subject: `Bienvenido a SellAlleS, ${String(vars.companyName ?? '')}`.trim(),
        // Genérico a propósito: no todas las empresas tienen activados los
        // mismos módulos, así que prometer "facturar y cuadrar caja" podía
        // nombrar cosas que ese cliente no verá al entrar.
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nTu cuenta de ${vars.companyName ?? 'tu empresa'} ya está lista en SellAlleS.\n\n${vars.trialEndsAt ? `Tu prueba gratis va hasta el ${fmtFecha(vars.trialEndsAt)}.\n\n` : ''}Cualquier duda, escríbenos.\n\nEquipo SellAlleS`,
        html: envolver('Tu cuenta ya está lista', `
          <p>Hola${nombre},</p>
          <p>La cuenta de <strong>${empresa}</strong> quedó activa en SellAlleS y ya puedes empezar a usarla.</p>
          ${vars.trialEndsAt ? `<p>Tu prueba gratis va hasta el <strong>${esc(fmtFecha(vars.trialEndsAt))}</strong>.</p>` : ''}
          <p>Si necesitas ayuda para arrancar, estamos aquí:</p>`, c),
      };

    case 'prueba-por-vencer': {
      const dias = Number(vars.daysLeft ?? 0);
      const cuando = dias === 1 ? 'mañana' : `en ${dias} días`;
      return {
        subject: `Tu prueba de SellAlleS termina ${cuando}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa prueba gratis de ${vars.companyName ?? 'tu empresa'} termina ${cuando} (${fmtFecha(vars.trialEndsAt)}).\n\nCuando termine podrás seguir viendo tus datos, pero no registrar ni modificar nada hasta activar tu cuenta.\n\nEquipo SellAlleS`,
        html: envolver(`Tu prueba termina ${cuando}`, `
          <p>Hola${nombre},</p>
          <p>La prueba gratis de <strong>${empresa}</strong> termina <strong>${esc(cuando)}</strong>${vars.trialEndsAt ? ` (${esc(fmtFecha(vars.trialEndsAt))})` : ''}.</p>
          <p>Cuando termine vas a poder <strong>seguir viendo tus datos</strong>, pero no registrar ventas ni modificar nada hasta activar la cuenta. Nada se borra.</p>
          <p>Para activarla, escríbenos:</p>`, c),
      };
    }

    case 'prueba-vencida':
      return {
        subject: 'Tu prueba de SellAlleS terminó',
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa prueba gratis de ${vars.companyName ?? 'tu empresa'} terminó. Tus datos siguen ahí y puedes consultarlos, pero no registrar ni modificar hasta activar la cuenta.\n\nEquipo SellAlleS`,
        html: envolver('Tu prueba terminó', `
          <p>Hola${nombre},</p>
          <p>La prueba gratis de <strong>${empresa}</strong> llegó a su fin.</p>
          <p><strong>Tus datos siguen intactos.</strong> Puedes entrar y consultarlos cuando quieras; lo que queda bloqueado es registrar ventas y modificar información, hasta que actives la cuenta.</p>
          <p>Activarla toma un minuto:</p>`, c),
      };

    case 'cuenta-activada':
      return {
        subject: 'Tu cuenta de SellAlleS está activa',
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa cuenta de ${vars.companyName ?? 'tu empresa'} quedó activa.${vars.paidUntil ? ` Tu suscripción cubre hasta el ${fmtFecha(vars.paidUntil)}.` : ''}\n\nEquipo SellAlleS`,
        html: envolver('Cuenta activada', `
          <p>Hola${nombre},</p>
          <p>Listo: la cuenta de <strong>${empresa}</strong> quedó <strong>activa</strong> y ya puedes operar con normalidad.</p>
          ${vars.paidUntil ? `<p>Tu suscripción cubre hasta el <strong>${esc(fmtFecha(vars.paidUntil))}</strong>.</p>` : ''}
          <p>Gracias por confiar en SellAlleS.</p>`, c),
      };

    case 'cobro-por-vencer': {
      // Dos formas de llegar: la de antes (por paid_until) y la de ahora, por
      // la cuenta de cada sucursal (dueDate + amount + bankAccounts).
      const dias = Number(vars.daysLeft ?? 0);
      const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
      const fecha = vars.dueDate ?? vars.paidUntil;
      const monto = vars.amount != null ? fmtMoneda(vars.amount) : null;
      return {
        subject: `Tu cuota de SellAlleS vence ${cuando}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nLa próxima cuota de ${vars.companyName ?? 'tu empresa'} vence ${cuando} (${fmtFecha(fecha)})${monto ? `: ${monto}` : ''}.\n\nCuando transfieras, sube el comprobante en Mi Suscripción y lo confirmamos.${textoBancos(vars.bankAccounts)}\n\nEquipo SellAlleS`,
        html: envolver(`Tu cuota vence ${cuando}`, `
          <p>Hola${nombre},</p>
          <p>La próxima cuota de <strong>${empresa}</strong> vence <strong>${esc(cuando)}</strong>${fecha ? ` (${esc(fmtFecha(fecha))})` : ''}${monto ? `: <strong>${esc(monto)}</strong>` : ''}.</p>
          ${bloqueBancos(vars.bankAccounts)}
          <p>Cuando transfieras, <strong>sube el comprobante en Mi Suscripción</strong> y lo confirmamos. Te llega la factura por correo.</p>
          ${boton('/suscripcion', 'Ir a Mi Suscripción')}`, c),
      };
    }

    case 'cuota-vencida': {
      const cuotas = Number(vars.cuotasPendientes ?? 0);
      return {
        subject: `Tienes ${cuotas === 1 ? 'una cuota pendiente' : `${cuotas} cuotas pendientes`} en SellAlleS`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\n${vars.companyName ?? 'Tu empresa'} tiene ${cuotas} ${cuotas === 1 ? 'cuota pendiente' : 'cuotas pendientes'} por ${fmtMoneda(vars.saldo)}${vars.debeDesde ? `, desde el ${fmtFecha(vars.debeDesde)}` : ''}.\n\nCuando transfieras, sube el comprobante en Mi Suscripción y lo confirmamos.${textoBancos(vars.bankAccounts)}\n\nEquipo SellAlleS`,
        html: envolver('Tienes cuotas pendientes', `
          <p>Hola${nombre},</p>
          <p><strong>${empresa}</strong> tiene <strong>${cuotas} ${cuotas === 1 ? 'cuota pendiente' : 'cuotas pendientes'}</strong> por <strong>${esc(fmtMoneda(vars.saldo))}</strong>${vars.debeDesde ? `, desde el ${esc(fmtFecha(vars.debeDesde))}` : ''}.</p>
          ${bloqueBancos(vars.bankAccounts)}
          <p>Cuando transfieras, <strong>sube el comprobante en Mi Suscripción</strong> y lo confirmamos. Si ya pagaste, ignora este mensaje.</p>
          ${boton('/suscripcion', 'Ir a Mi Suscripción')}`, c),
      };
    }

    case 'pago-rechazado':
      return {
        subject: 'No pudimos confirmar tu pago — SellAlleS',
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nRevisamos el comprobante de ${fmtMoneda(vars.amount)}${vars.paidAt ? ` del ${fmtFecha(vars.paidAt)}` : ''} de ${vars.companyName ?? 'tu empresa'} y no lo pudimos confirmar.\n\nMotivo: ${vars.reason ?? ''}\n\nPuedes subir uno nuevo en Mi Suscripción.\n\nEquipo SellAlleS`,
        html: envolver('No pudimos confirmar tu pago', `
          <p>Hola${nombre},</p>
          <p>Revisamos el comprobante de <strong>${esc(fmtMoneda(vars.amount))}</strong>${vars.paidAt ? ` del ${esc(fmtFecha(vars.paidAt))}` : ''} de <strong>${empresa}</strong> y no lo pudimos confirmar.</p>
          <div style="background:#FEF2F2;border:1px solid #FECACA;padding:12px 15px;border-radius:5px;margin:16px 0;">
            <p style="margin:0;"><strong>Motivo:</strong> ${esc(vars.reason)}</p>
          </div>
          <p>Puedes subir un comprobante nuevo en <strong>Mi Suscripción</strong>. Si crees que es un error, escríbenos:</p>
          ${boton('/suscripcion', 'Ir a Mi Suscripción')}`, c),
      };

    case 'comprobante-recibido':
      return {
        subject: `Comprobante por confirmar: ${String(vars.companyName ?? '')} — ${fmtMoneda(vars.amount)}`,
        text: `${vars.companyName ?? 'Una empresa'} subió un comprobante de ${fmtMoneda(vars.amount)}${vars.paidAt ? ` del ${fmtFecha(vars.paidAt)}` : ''}${vars.bank ? ` a ${vars.bank}` : ''}${vars.reference ? ` (ref. ${vars.reference})` : ''}.\nLo subió: ${vars.reportedBy ?? '—'}.\nSegún su cuenta debía ${fmtMoneda(vars.saldo)}.\n\nVerifica en tu banco y confírmalo en Cobros.`,
        html: envolver('Comprobante por confirmar', `
          <p><strong>${empresa}</strong> subió un comprobante de pago.</p>
          <div style="background:#FFFBEB;border:1px solid #FDE68A;padding:15px;border-radius:5px;margin:16px 0;">
            <p style="margin:0 0 8px 0;"><strong>Monto:</strong> ${esc(fmtMoneda(vars.amount))}</p>
            ${vars.paidAt ? `<p style="margin:0 0 8px 0;"><strong>Fecha de la transferencia:</strong> ${esc(fmtFecha(vars.paidAt))}</p>` : ''}
            ${vars.bank ? `<p style="margin:0 0 8px 0;"><strong>Cuenta:</strong> ${esc(vars.bank)}</p>` : ''}
            ${vars.reference ? `<p style="margin:0 0 8px 0;"><strong>Referencia:</strong> ${esc(vars.reference)}</p>` : ''}
            ${vars.notes ? `<p style="margin:0 0 8px 0;"><strong>Nota:</strong> ${esc(vars.notes)}</p>` : ''}
            <p style="margin:0;"><strong>Lo subió:</strong> ${esc(vars.reportedBy ?? '—')}</p>
          </div>
          <p>Según su cuenta debía <strong>${esc(fmtMoneda(vars.saldo))}</strong>${Number(vars.cuotasPendientes ?? 0) > 0 ? ` (${esc(vars.cuotasPendientes)} cuotas)` : ''}.</p>
          <p><strong>Verifica en tu banco</strong> que el dinero llegó y confírmalo en <strong>Cobros → Por confirmar</strong>. La factura se crea al confirmar.</p>
          ${boton('/admin/cobros', 'Abrir Cobros')}`, c),
      };

    case 'resumen-cobros': {
      type Pendiente = { companyName?: string; amount?: number; paidAt?: string; bank?: string; reference?: string };
      type Suc = { nombre?: string; pendientes?: number; debeDesde?: string };
      type Atrasado = { companyName?: string; saldo?: number; diasAtraso?: number; cuotasPendientes?: number; debeDesde?: string; nuncaPago?: boolean; soloVentas?: boolean; sugerirSoloVentas?: boolean; porConfirmar?: number; sucursales?: Suc[] };
      type PorVencer = { companyName?: string; proximoCobro?: string; dias?: number; mensual?: number };
      const pendientes = (Array.isArray(vars.pendientes) ? vars.pendientes : []) as Pendiente[];
      const atrasados = (Array.isArray(vars.atrasados) ? vars.atrasados : []) as Atrasado[];
      const porVencer = (Array.isArray(vars.porVencer) ? vars.porVencer : []) as PorVencer[];
      const totalAtrasado = atrasados.reduce((acc, a) => acc + Number(a.saldo ?? 0), 0);
      const sugeridas = atrasados.filter((a) => a.sugerirSoloVentas);

      const seccion = (titulo: string, color: string, filas: string) => `
        <h3 style="color:${color};margin:24px 0 8px 0;font-size:16px;">${titulo}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${filas}</table>`;
      const td = 'padding:8px 6px;border-bottom:1px solid #E5E7EB;vertical-align:top;';

      const htmlPendientes = pendientes.length ? seccion(`🟡 Comprobantes por confirmar (${pendientes.length})`, '#B45309',
        pendientes.map((p) => `<tr><td style="${td}"><strong>${esc(p.companyName)}</strong><br><span style="color:#6B7280;font-size:12px;">${esc(p.bank ?? 'Cuenta no indicada')}${p.reference ? ` · ref. ${esc(p.reference)}` : ''}</span></td><td style="${td}text-align:right;">${esc(fmtMoneda(p.amount))}<br><span style="color:#6B7280;font-size:12px;">${esc(fmtFecha(p.paidAt))}</span></td></tr>`).join('')) : '';

      const htmlAtrasados = atrasados.length ? seccion(`🔴 Atrasados (${atrasados.length}) — ${fmtMoneda(totalAtrasado)}`, '#B91C1C',
        atrasados.map((a) => {
          const sucs = (a.sucursales ?? []).map((x) => `${esc(x.nombre)}: ${esc(x.pendientes)} ${Number(x.pendientes) === 1 ? 'cuota' : 'cuotas'} desde ${esc(fmtFecha(x.debeDesde))}`).join('<br>');
          const marcas = [
            a.nuncaPago ? 'nunca ha pagado' : null,
            a.soloVentas ? 'ya está en solo ventas' : null,
            a.sugerirSoloVentas ? '<strong style="color:#B91C1C;">sugerido: pasar a solo ventas</strong>' : null,
            Number(a.porConfirmar ?? 0) > 0 ? `tiene ${esc(fmtMoneda(a.porConfirmar))} por confirmar` : null,
          ].filter(Boolean).join(' · ');
          return `<tr><td style="${td}"><strong>${esc(a.companyName)}</strong> — ${esc(a.diasAtraso)} días de atraso${marcas ? `<br><span style="font-size:12px;color:#6B7280;">${marcas}</span>` : ''}${sucs ? `<br><span style="font-size:12px;">${sucs}</span>` : ''}</td><td style="${td}text-align:right;white-space:nowrap;"><strong>${esc(fmtMoneda(a.saldo))}</strong><br><span style="color:#6B7280;font-size:12px;">${esc(a.cuotasPendientes)} cuotas</span></td></tr>`;
        }).join('')) : '';

      const htmlPorVencer = porVencer.length ? seccion(`🟢 Les toca pagar pronto (${porVencer.length})`, '#047857',
        porVencer.map((v) => `<tr><td style="${td}"><strong>${esc(v.companyName)}</strong><br><span style="color:#6B7280;font-size:12px;">${Number(v.dias) === 0 ? 'hoy' : `en ${esc(v.dias)} días`} (${esc(fmtFecha(v.proximoCobro))})</span></td><td style="${td}text-align:right;">${esc(fmtMoneda(v.mensual))}/mes</td></tr>`).join('')) : '';

      const lineas: string[] = [];
      if (pendientes.length) lineas.push(`Comprobantes por confirmar: ${pendientes.length}`);
      if (atrasados.length) lineas.push(`Atrasados: ${atrasados.length} (${fmtMoneda(totalAtrasado)})${sugeridas.length ? `, ${sugeridas.length} para pasar a solo ventas` : ''}`);
      if (porVencer.length) lineas.push(`Les toca pagar pronto: ${porVencer.length}`);

      return {
        subject: `Resumen de cobros ${fmtFecha(vars.fecha)}${pendientes.length ? ` — ${pendientes.length} por confirmar` : ''}`,
        text: `Resumen de cobros del ${fmtFecha(vars.fecha)}\n\n${lineas.join('\n')}\n\nEl detalle está en Cobros.`,
        html: envolver(`Resumen de cobros — ${fmtFecha(vars.fecha)}`, `
          ${htmlPendientes}${htmlAtrasados}${htmlPorVencer}
          ${sugeridas.length ? `<p style="margin-top:20px;">Pasar a solo ventas es manual: desde Cobros, en cada empresa.</p>` : ''}
          ${boton('/admin/cobros', 'Abrir Cobros')}`, c),
      };
    }

    case 'recibo-suscripcion': {
      // Con la factura adjunta el correo se presenta como factura; sin ella
      // (el adjunto falló o lo llama alguien que no lo manda) sigue siendo el
      // recibo de siempre, para no prometer un PDF que no viene.
      const factura = conAdjunto && vars.invoiceNumber ? String(vars.invoiceNumber) : null;
      return {
        subject: factura
          ? `Factura No. ${factura} — SellAlleS`
          : `Recibo de pago — SellAlleS${vars.paidUntil ? ` (hasta ${fmtFecha(vars.paidUntil)})` : ''}`,
        text: `Hola${vars.userName ? ` ${vars.userName}` : ''},\n\nRecibimos tu pago de ${fmtMoneda(vars.amount)} para ${vars.companyName ?? 'tu empresa'}.${vars.paidUntil ? ` Tu suscripción queda cubierta hasta el ${fmtFecha(vars.paidUntil)}.` : ''}${factura ? `\n\nTe adjuntamos la factura No. ${factura} en PDF.` : ''}\n\nEquipo SellAlleS`,
        html: envolver(factura ? `Factura No. ${factura}` : 'Recibo de pago', `
          <p>Hola${nombre},</p>
          <p>Recibimos tu pago de suscripción para <strong>${empresa}</strong>.</p>
          ${factura ? `<p>Te adjuntamos la factura <strong>No. ${esc(factura)}</strong> en PDF. También la puedes descargar cuando quieras desde <strong>Mi Suscripción</strong>.</p>` : ''}
          <div style="background:#F9FAFB;padding:15px;border-radius:5px;margin:20px 0;">
            ${factura ? `<p style="margin:0 0 8px 0;"><strong>Factura:</strong> No. ${esc(factura)}</p>` : ''}
            <p style="margin:0 0 8px 0;"><strong>Monto:</strong> ${esc(fmtMoneda(vars.amount))}</p>
            ${vars.method ? `<p style="margin:0 0 8px 0;"><strong>Método:</strong> ${esc(vars.method)}</p>` : ''}
            ${vars.paidAt ? `<p style="margin:0 0 8px 0;"><strong>Fecha:</strong> ${esc(fmtFecha(vars.paidAt))}</p>` : ''}
            ${vars.paidUntil ? `<p style="margin:0;"><strong>Cubre hasta:</strong> ${esc(fmtFecha(vars.paidUntil))}</p>` : ''}
          </div>`, c),
      };
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
    });

    // Dos formas legítimas de llamar: el job programado con la service role
    // key, o un super admin desde el panel. Nadie más.
    const esSistema = token === serviceKey;
    if (!esSistema) {
      const { data: caller } = await admin.auth.getUser(token);
      if (!caller?.user) return json(401, { error: 'Sesión inválida.' });
      const { data: perfil } = await admin
        .from('profiles')
        .select('is_super_admin')
        .eq('id', caller.user.id)
        .single();
      if (!perfil?.is_super_admin) {
        return json(403, { error: 'Solo el administrador de la plataforma puede enviar estos correos.' });
      }
    }

    const body = await req.json().catch(() => null);
    const template = body?.template as Template | undefined;
    const to = String(body?.to ?? '').trim().toLowerCase();
    const companyId = body?.companyId ?? null;
    const vars = (body?.vars ?? {}) as Record<string, unknown>;
    const dedupeKey = String(body?.dedupeKey ?? '').trim();

    const validas: Template[] = [
      'bienvenida', 'prueba-por-vencer', 'prueba-vencida', 'cuenta-activada',
      'recibo-suscripcion', 'cobro-por-vencer', 'cuota-vencida', 'pago-rechazado',
      'comprobante-recibido', 'resumen-cobros',
    ];
    if (!template || !validas.includes(template)) return json(400, { error: 'Plantilla no reconocida.' });
    if (!to || !to.includes('@')) return json(400, { error: 'Destinatario inválido.' });
    if (!dedupeKey) return json(400, { error: 'Falta dedupeKey.' });

    // Adjunto opcional: hoy solo la factura de suscripción, un PDF de pocos KB
    // armado en el navegador. El tope deja aire de sobra y a la vez impide usar
    // esto para mandar archivos cualquiera.
    let attachments: { filename: string; content: string }[] | undefined;
    if (body?.attachment) {
      const filename = String(body.attachment.filename ?? '').trim();
      const content = String(body.attachment.content ?? '');
      const valido =
        /^[\w.-]{1,80}\.pdf$/i.test(filename) &&
        content.length > 0 &&
        content.length <= 2_000_000 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(content);
      if (!valido) return json(400, { error: 'Adjunto inválido: se espera un PDF en base64.' });
      attachments = [{ filename, content }];
    }

    // No insistirle a una dirección que ya rebotó: cada rebote extra empeora la
    // reputación del dominio y termina afectando hasta los correos de auth.
    const { data: rebotado } = await admin
      .from('profiles')
      .select('email_bounced_at')
      .ilike('email', to)
      .not('email_bounced_at', 'is', null)
      .maybeSingle();
    if (rebotado) return json(200, { ok: true, skipped: 'correo_rebotado' });

    // Tope diario del plan Free.
    const desdeMedianoche = new Date();
    desdeMedianoche.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from('platform_email_log')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('created_at', desdeMedianoche.toISOString());
    if ((count ?? 0) >= TOPE_DIARIO) {
      console.error(`Tope diario alcanzado (${count}/${TOPE_DIARIO}); no se envía ${template} a ${to}.`);
      return json(429, { error: 'Tope diario de correos alcanzado.', enviadosHoy: count });
    }

    // Se reserva la clave ANTES de enviar. Si dos procesos corren a la vez, uno
    // choca contra el índice único y no se manda el correo duplicado. Al revés
    // (enviar y después registrar) habría ventana para mandarlo dos veces.
    const { data: reserva, error: reservaErr } = await admin
      .from('platform_email_log')
      .insert({ company_id: companyId, template, to_email: to, dedupe_key: dedupeKey })
      .select('id')
      .single();
    if (reservaErr) {
      if ((reservaErr as { code?: string }).code === '23505') {
        return json(200, { ok: true, skipped: 'ya_enviado' });
      }
      throw new Error(reservaErr.message);
    }

    // Contacto vigente desde la configuración de plataforma.
    const { data: settings } = await admin
      .from('platform_settings')
      .select('support_whatsapp_enabled, support_whatsapp_number, support_whatsapp_label, support_email_enabled, support_email, support_hours')
      .maybeSingle();
    const contacto: Contacto = {
      whatsappEnabled: settings?.support_whatsapp_enabled ?? false,
      whatsappNumber: settings?.support_whatsapp_number ?? null,
      whatsappLabel: settings?.support_whatsapp_label ?? null,
      emailEnabled: settings?.support_email_enabled ?? false,
      email: settings?.support_email ?? null,
      hours: settings?.support_hours ?? null,
    };

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json(500, { error: 'Falta RESEND_API_KEY.' });
    const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'SellAlleS <soporte@sellalles.com>';

    const { subject, html, text } = render(
      template, vars, PARA_LA_PLATAFORMA.includes(template) ? SIN_CONTACTO : contacto, !!attachments,
    );

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          subject,
          html,
          text,
          ...(attachments ? { attachments } : {}),
          ...(contacto.emailEnabled && contacto.email ? { reply_to: contacto.email } : {}),
        }),
      });
      if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
      const enviado = await resp.json().catch(() => null);

      await admin
        .from('platform_email_log')
        .update({ resend_email_id: enviado?.id ?? null })
        .eq('id', reserva.id);

      return json(200, { ok: true, resendId: enviado?.id ?? null });
    } catch (e) {
      // La reserva queda marcada como fallida. El índice único es parcial y no
      // cuenta los 'failed', así que un reintento posterior sí puede enviar.
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from('platform_email_log')
        .update({ status: 'failed', error: msg.slice(0, 500) })
        .eq('id', reserva.id);
      console.error(`Fallo enviando ${template} a ${to}: ${msg}`);
      return json(502, { error: 'No se pudo enviar el correo.', detalle: msg });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('send-lifecycle-email:', msg);
    return json(500, { error: msg });
  }
});
