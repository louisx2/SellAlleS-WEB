// Cobro de SellAlleS para un sistema externo: hoy Anadsll, el panel de un salón que es una empresa más aquí.
//
// Se identifica con una clave de conexión (encabezado x-clave-cobro), no con una sesión: la clave apunta a UNA
// empresa y la base guarda solo su sha-256 (claves_cobro_externo, por _empresa_de_clave). Todo lo que se lee o
// se escribe queda filtrado por esa empresa. Las reglas son las mismas de la app: la cuenta sale de
// _cuenta_de_suscripcion y el reporte pasa por _reportar_pago, así que también dispara el correo
// "comprobante recibido" al super admin.
//
// El comprobante no pasa por aquí (un archivo grande no cabe en el cuerpo de la función): 'subida' entrega un
// permiso de subida de un solo uso para comprobantes-de-pago/<empresa>/<uuid>.<ext>, el navegador sube directo
// y después 'reportar' crea el reporte. La factura sí sale de aquí, dibujada con el mismo módulo que la app.
//
// Se despliega con verify_jwt = false: la seguridad es la clave.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { jsPDF } from 'npm:jspdf@4.2.1';
import {
  codigoDeFactura, crearFactura, nombreArchivoFactura, pagoDesdeFila, type ConstructorPdf,
} from '../_shared/factura-suscripcion.ts';

const BUCKET = 'comprobantes-de-pago';
const TAMANO_MAXIMO = 10 * 1024 * 1024;
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function json(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256Hex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const textoONull = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
};

async function estado(db: SupabaseClient, empresa: string) {
  const [emp, cuenta, bancos, reportes, pagos] = await Promise.all([
    db.from('companies').select('name').eq('id', empresa).single(),
    db.rpc('_cuenta_de_suscripcion', { p_company_id: empresa }),
    db.from('platform_bank_accounts')
      .select('id, bank, account_type, account_number, holder_name, holder_id, currency')
      .eq('is_active', true).order('sort_order').order('created_at'),
    db.from('subscription_payment_reports')
      .select('id, amount, paid_at, bank_label, reference, notes, status, reject_reason, file_name, created_at')
      .eq('company_id', empresa).order('created_at', { ascending: false }).limit(20),
    db.from('subscription_payments')
      .select('id, amount, paid_at, method, reference, period_start, period_end, plan_name, invoice_number')
      .eq('company_id', empresa).order('paid_at', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  const error = emp.error ?? cuenta.error ?? bancos.error ?? reportes.error ?? pagos.error;
  if (error) throw error;
  return {
    empresa: { nombre: emp.data.name as string },
    cuenta: cuenta.data,
    bancos: (bancos.data ?? []).map((b) => ({
      id: b.id,
      banco: b.bank,
      tipo: b.account_type === 'corriente' ? 'corriente' : 'ahorro',
      numero: b.account_number,
      titular: b.holder_name,
      documento: b.holder_id ?? null,
      moneda: b.currency === 'USD' ? 'USD' : 'DOP',
    })),
    reportes: (reportes.data ?? []).map((r) => ({
      id: r.id,
      monto: Number(r.amount),
      fecha: r.paid_at,
      banco: r.bank_label ?? null,
      referencia: r.reference ?? null,
      nota: r.notes ?? null,
      estado: r.status,
      motivo: r.reject_reason ?? null,
      archivo: r.file_name ?? null,
      creado: r.created_at,
    })),
    pagos: (pagos.data ?? []).map((p) => ({
      id: p.id,
      monto: Number(p.amount),
      fecha: p.paid_at,
      metodo: p.method,
      referencia: p.reference ?? null,
      desde: p.period_start ?? null,
      hasta: p.period_end ?? null,
      plan: p.plan_name ?? null,
      codigo: codigoDeFactura(p),
      tieneFactura: p.invoice_number != null,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const clave = req.headers.get('x-clave-cobro') ?? '';
  if (!clave.startsWith('cobro_')) return json(401, { error: 'clave' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: filasClave, error: errorClave } = await db.rpc('_empresa_de_clave', {
    p_clave_hash: await sha256Hex(clave),
  });
  if (errorClave) return json(500, { error: 'No se pudo comprobar la clave.' });
  const conexion = (filasClave ?? [])[0] as { company_id: string; etiqueta: string } | undefined;
  if (!conexion) return json(401, { error: 'clave' });
  const empresa = conexion.company_id;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: 'Cuerpo inválido.' });
  }

  try {
    switch (cuerpo.accion) {
      case 'estado':
        return json(200, await estado(db, empresa));

      case 'subida': {
        const mime = String(cuerpo.mime ?? '');
        const tamano = Number(cuerpo.tamano);
        const ext = Object.hasOwn(EXTENSION, mime) ? EXTENSION[mime] : undefined;
        if (!ext) return json(400, { error: 'El comprobante tiene que ser una foto o un PDF.' });
        if (!(tamano > 0) || tamano > TAMANO_MAXIMO) {
          return json(400, { error: 'El archivo pesa más de 10 MB. Sube una captura de pantalla o un PDF más liviano.' });
        }
        const path = `${empresa}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) return json(500, { error: 'No se pudo preparar la subida del comprobante.' });
        return json(200, {
          path: data.path,
          token: data.token,
          url: Deno.env.get('SUPABASE_URL'),
          apikey: Deno.env.get('SUPABASE_ANON_KEY'),
        });
      }

      case 'reportar': {
        const bancoId = cuerpo.banco_id == null || cuerpo.banco_id === '' ? null : String(cuerpo.banco_id);
        if (bancoId && !UUID.test(bancoId)) return json(400, { error: 'La cuenta bancaria elegida no existe.' });
        const fecha = String(cuerpo.fecha ?? '');
        if (!FECHA.test(fecha)) return json(400, { error: 'La fecha del pago no es válida.' });
        const f = new Date(`${fecha}T00:00:00Z`);
        if (Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== fecha) {
          return json(400, { error: 'La fecha del pago no es válida.' });
        }
        const { data, error } = await db.rpc('_reportar_pago', {
          p_company_id: empresa,
          p_reportado_por: null,
          p_reportado_por_nombre: conexion.etiqueta,
          p_amount: Number(cuerpo.monto),
          p_paid_at: fecha,
          p_bank_account_id: bancoId,
          p_reference: textoONull(cuerpo.referencia),
          p_notes: textoONull(cuerpo.nota),
          p_file_path: String(cuerpo.path ?? ''),
          p_file_name: textoONull(cuerpo.nombre),
          p_file_mime: textoONull(cuerpo.mime),
          p_file_sha256: textoONull(cuerpo.sha256),
        });
        if (error) {
          if (error.code === 'P0001') return json(400, { error: error.message });
          console.error('cobro-externo reportar:', error);
          return json(500, { error: 'No se pudo registrar el pago. Intenta de nuevo.' });
        }
        return json(200, { reporte: { id: (data as { id: string }).id } });
      }

      case 'retirar': {
        const id = String(cuerpo.reporte_id ?? '');
        if (!UUID.test(id)) return json(404, { error: 'No encontrado.' });
        const { error } = await db.rpc('_anular_reporte', { p_company_id: empresa, p_report_id: id });
        if (error) {
          if (error.code === 'P0001') return json(400, { error: error.message });
          console.error('cobro-externo retirar:', error);
          return json(500, { error: 'No se pudo retirar el comprobante. Intenta de nuevo.' });
        }
        return json(200, { ok: true });
      }

      case 'comprobante': {
        const id = String(cuerpo.reporte_id ?? '');
        if (!UUID.test(id)) return json(404, { error: 'No encontrado.' });
        const { data: fila, error: errorFila } = await db.from('subscription_payment_reports')
          .select('file_path').eq('id', id).eq('company_id', empresa).maybeSingle();
        if (errorFila) {
          console.error('cobro-externo comprobante:', errorFila);
          return json(500, { error: 'No se pudo abrir el comprobante.' });
        }
        if (!fila) return json(404, { error: 'No encontrado.' });
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(fila.file_path, 300);
        if (error || !data) return json(500, { error: 'No se pudo abrir el comprobante.' });
        return json(200, { url: data.signedUrl });
      }

      case 'factura': {
        const id = String(cuerpo.pago_id ?? '');
        if (!UUID.test(id)) return json(404, { error: 'No encontrado.' });
        const { data: fila, error: errorFila } = await db.from('subscription_payments')
          .select('*').eq('id', id).eq('company_id', empresa).maybeSingle();
        if (errorFila) {
          console.error('cobro-externo factura:', errorFila);
          return json(500, { error: 'No se pudo generar la factura.' });
        }
        if (!fila) return json(404, { error: 'No encontrado.' });
        if (fila.invoice_number == null) return json(404, { error: 'Este pago no tiene factura.' });
        const pago = pagoDesdeFila(fila);
        const doc = crearFactura(jsPDF as unknown as ConstructorPdf, pago);
        return new Response(doc.output('arraybuffer'), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${nombreArchivoFactura(pago)}"`,
          },
        });
      }

      default:
        return json(400, { error: 'Acción desconocida.' });
    }
  } catch (e) {
    console.error('cobro-externo:', e);
    return json(500, { error: 'Error interno.' });
  }
});
