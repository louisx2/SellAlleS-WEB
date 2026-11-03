// ecf-emitir: manda un comprobante electrónico (e-CF) a MSeller y devuelve su
// código de seguridad y su QR para el ticket.
//
// Cómo se llama:
//   * { saleId }          el punto de venta, al guardar la venta;
//   * { creditNoteId }    el punto de venta, al anular (nota de crédito E34);
//   * { documentoIds }    el cron de la base (ecf_disparar_envios), solo con la
//                         service role key. Reintenta lo que quedó sin enviar.
//
// Qué hace: valida quién llama, busca el documento vigente de esa venta o nota,
// y deja que `emitirDocumento` (módulo puro, con pruebas) lo reserve, lo arme
// desde la base, lo envíe y registre el resultado. Aquí solo está lo que toca
// Supabase y la red: leer las filas, las RPC del servidor y la respuesta HTTP.
//
// Las credenciales de MSeller nunca salen de aquí: se leen con la service role
// (ecf_leer_credenciales), se usan en memoria y no se devuelven ni se registran.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { lineasDesdeItems } from '../_shared/ecf/armar.ts';
import type { DatosEcf, TipoEcf } from '../_shared/ecf/armar.ts';
import { datosEcf, vencimientoDeSecuencia } from '../_shared/ecf/datos.ts';
import type { FilaSecuencia } from '../_shared/ecf/datos.ts';
import { completarDocumento, emitirDocumento, ErrorDatosEcf } from '../_shared/ecf/emitir.ts';
import type { CambioDocumento, DepsEmision, DocReservado } from '../_shared/ecf/emitir.ts';
import type { Ambiente, Credenciales, Sesion } from '../_shared/ecf/mseller.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

type Cliente = SupabaseClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_QUE_SE_EMITEN: number[] = [31, 32, 34, 44, 45];
const ZONA_POR_DEFECTO = 'America/Santo_Domingo';
// El cron manda hasta 50; el tope evita que una llamada tarde más que la función.
const MAX_DOCUMENTOS = 100;
const EN_PARALELO = 5;
// Estados en los que MSeller ya tiene el documento: se devuelve tal cual (sirve para reimprimir).
const YA_RECIBIDOS = ['recibido', 'aceptado', 'aceptado_condicional'];
const POR_EMITIR = ['por_enviar', 'enviando'];

// Todo menos `request_json`: es la copia de lo enviado, solo para soporte.
const COLUMNAS_DOCUMENTO =
  'id, company_id, branch_id, sale_id, credit_note_id, tipo_ecf, encf, ambiente, estado, ' +
  'security_code, qr_url, signed_at, internal_track_id, mensajes_dgii, intentos, proximo_intento_at, ' +
  'ultimo_error, enviado_at, estado_at, ultima_consulta_at, reemplazado_por, created_at, updated_at';

interface FilaDocumento {
  id: string;
  company_id: string;
  encf: string;
  ambiente: string;
  estado: string;
  qr_url: string | null;
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Lectura de filas (service role)
// ---------------------------------------------------------------------------

interface Respuesta {
  data: unknown;
  error: { message: string } | null;
}

async function filas<T>(consulta: PromiseLike<Respuesta>, que: string): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`No se pudo leer ${que}: ${error.message}`);
  if (Array.isArray(data)) return data as T[];
  return data ? [data as T] : [];
}

async function una<T>(consulta: PromiseLike<Respuesta>, que: string): Promise<T | null> {
  return (await filas<T>(consulta, que))[0] ?? null;
}

const numero = (v: unknown) => Number(v);

/** Todo lo que `armarEcf` necesita, leído de la base (no de lo que mande el navegador). */
async function cargarDatos(admin: Cliente, doc: DocReservado): Promise<DatosEcf> {
  const origen = await una<{ sale_id: string | null; credit_note_id: string | null; tipo_ecf: number | null }>(
    admin.from('ecf_documentos').select('sale_id, credit_note_id, tipo_ecf').eq('id', doc.id).limit(1),
    'el documento',
  );
  if (!origen) throw new ErrorDatosEcf('El documento ya no existe.');

  const tipo = origen.tipo_ecf ?? Number(doc.encf.slice(1, 3));
  if (!TIPOS_QUE_SE_EMITEN.includes(tipo)) {
    throw new ErrorDatosEcf(`El comprobante tipo ${tipo} todavía no se emite desde SellAlleS.`);
  }

  const [empresa, config] = await Promise.all([
    una<{ timezone: string | null }>(
      admin.from('companies').select('timezone').eq('id', doc.companyId).limit(1),
      'la empresa',
    ),
    una<{ rnc_emisor: string | null; razon_social: string; nombre_comercial: string | null; direccion: string }>(
      admin
        .from('ecf_config')
        .select('rnc_emisor, razon_social, nombre_comercial, direccion')
        .eq('company_id', doc.companyId)
        .limit(1),
      'la configuración de e-CF',
    ),
  ]);
  if (!config) throw new ErrorDatosEcf('La empresa no tiene configurada la facturación electrónica.');
  if (!config.rnc_emisor) throw new ErrorDatosEcf('Falta el RNC del emisor en la configuración de e-CF.');

  // En una nota de crédito, las líneas, el cliente y la fecha de referencia son
  // los de la venta original; el e-NCF que modifica es el de su documento.
  let ventaId = origen.sale_id;
  let nota: { created_at: string; total: number; itbis_amount: number; encfOriginal: string } | undefined;
  if (tipo === 34) {
    if (!origen.credit_note_id) throw new ErrorDatosEcf('El documento E34 no está enlazado a una nota de crédito.');
    const n = await una<{
      sale_id: string;
      ncf_modified: string | null;
      total: number | string;
      itbis_amount: number | string;
      created_at: string;
    }>(
      admin
        .from('credit_notes')
        .select('sale_id, ncf_modified, total, itbis_amount, created_at')
        .eq('id', origen.credit_note_id)
        .limit(1),
      'la nota de crédito',
    );
    if (!n) throw new ErrorDatosEcf('La nota de crédito ya no existe.');
    ventaId = n.sale_id;
    const original = await una<{ encf: string }>(
      admin
        .from('ecf_documentos')
        .select('encf')
        .eq('sale_id', n.sale_id)
        .is('reemplazado_por', null)
        .order('created_at', { ascending: false })
        .limit(1),
      'el comprobante original',
    );
    const encfOriginal = original?.encf ?? n.ncf_modified;
    if (!encfOriginal) throw new ErrorDatosEcf('No se encontró el e-NCF del comprobante que la nota modifica.');
    nota = {
      created_at: n.created_at,
      total: numero(n.total),
      itbis_amount: numero(n.itbis_amount),
      encfOriginal,
    };
  }
  if (!ventaId) throw new ErrorDatosEcf('El documento no está enlazado a una venta.');

  const venta = await una<{
    customer_id: string | null;
    total: number | string;
    itbis_amount: number | string;
    itbis_included: boolean | null;
    payment_status: string;
    created_at: string;
  }>(
    admin
      .from('sales')
      .select('customer_id, total, itbis_amount, itbis_included, payment_status, created_at')
      .eq('id', ventaId)
      .limit(1),
    'la venta',
  );
  if (!venta) throw new ErrorDatosEcf('La venta ya no existe.');

  const items = await filas<{
    product_id: string | null;
    product_name: string;
    quantity: number | string;
    price: number | string;
    custom_price: number | string | null;
    itbis: boolean | null;
  }>(
    admin
      .from('sale_items')
      .select('product_id, product_name, quantity, price, custom_price, itbis')
      .eq('sale_id', ventaId),
    'las líneas de la venta',
  );

  const productoIds = [...new Set(items.map((i) => i.product_id).filter((x): x is string => !!x))];
  const productos = productoIds.length
    ? await filas<{ id: string; es_servicio: boolean | null }>(
        admin.from('products').select('id, es_servicio').in('id', productoIds),
        'los productos',
      )
    : [];
  const servicioPorProducto = new Map(productos.map((p) => [p.id, p.es_servicio === true]));

  const lineas = lineasDesdeItems(
    items.map((i) => ({
      product_name: i.product_name,
      quantity: numero(i.quantity),
      price: numero(i.price),
      custom_price: i.custom_price === null ? null : numero(i.custom_price),
      itbis: i.itbis === true,
      es_servicio: i.product_id ? servicioPorProducto.get(i.product_id) ?? false : false,
    })),
  );

  const cliente = venta.customer_id
    ? await una<{ name: string | null; rnc: string | null }>(
        admin.from('customers').select('name, rnc').eq('id', venta.customer_id).limit(1),
        'el cliente',
      )
    : null;

  // La fecha límite de pago de una venta a plazos es la de su última cuota.
  let ultimaCuota: string | null = null;
  if (venta.payment_status === 'in_financing') {
    const cuota = await una<{ due_date: string }>(
      admin
        .from('financing_installments')
        .select('due_date')
        .eq('sale_id', ventaId)
        .order('due_date', { ascending: false })
        .limit(1),
      'las cuotas',
    );
    ultimaCuota = cuota?.due_date ?? null;
  }

  // El E32 y el E34 no llevan vencimiento de la secuencia: no hace falta buscarla.
  let vencimientoSecuencia: string | undefined;
  if (tipo !== 32 && tipo !== 34) {
    const secuencias = await filas<FilaSecuencia>(
      admin
        .from('ncf_sequences')
        .select('prefix, range_from, range_to, expires_at')
        .eq('company_id', doc.companyId)
        .eq('electronica', true)
        .eq('prefix', doc.encf.slice(0, 3)),
      'las secuencias',
    );
    vencimientoSecuencia = vencimientoDeSecuencia(doc.encf, secuencias);
  }

  return datosEcf({
    tipo: tipo as TipoEcf,
    encf: doc.encf,
    zona: empresa?.timezone || ZONA_POR_DEFECTO,
    emisor: {
      rnc: config.rnc_emisor,
      razonSocial: config.razon_social,
      nombreComercial: config.nombre_comercial,
      direccion: config.direccion,
    },
    venta: {
      created_at: venta.created_at,
      total: numero(venta.total),
      itbis_amount: numero(venta.itbis_amount),
      itbis_included: venta.itbis_included,
      payment_status: String(venta.payment_status),
    },
    lineas,
    cliente,
    ultimaCuota,
    vencimientoSecuencia,
    nota,
  });
}

// ---------------------------------------------------------------------------
// Dependencias de la emisión (RPC del servidor y tablas, siempre con la service role)
// ---------------------------------------------------------------------------

function crearDeps(admin: Cliente): DepsEmision {
  return {
    reservar: async (id) => {
      const { data, error } = await admin.rpc('ecf_reservar_documento', { p_id: id });
      if (error) throw new Error(`No se pudo reservar el documento: ${error.message}`);
      // La función devuelve `setof`: nada si otro llegó primero o aún no toca.
      const fila = (Array.isArray(data) ? data[0] : data) as
        | { id: string; company_id: string; encf: string; ambiente: string; intentos: number }
        | undefined;
      if (!fila) return null;
      return {
        id: fila.id,
        companyId: fila.company_id,
        encf: fila.encf,
        ambiente: fila.ambiente as Ambiente,
        intentos: fila.intentos,
      };
    },

    cargarDatos: (doc) => cargarDatos(admin, doc),

    leerCredenciales: async (companyId, ambiente) => {
      const { data, error } = await admin.rpc('ecf_leer_credenciales', {
        p_company: companyId,
        p_ambiente: ambiente,
      });
      // Los mensajes de aquí no incluyen lo leído: viajan a ultimo_error.
      if (error) throw new Error(`No se pudieron leer las credenciales de MSeller: ${error.message}`);
      if (!data) throw new Error(`La empresa no tiene credenciales de MSeller guardadas para ${ambiente}.`);
      const c = data as Record<string, string | null>;
      if (!c.email || !c.password || !c.api_key) {
        throw new Error(`Las credenciales de MSeller de ${ambiente} están incompletas.`);
      }
      const cred: Credenciales = {
        email: c.email,
        password: c.password,
        apiKey: c.api_key,
        refreshToken: c.refresh_token ?? null,
        sub: c.sub ?? null,
        idToken: c.id_token ?? null,
        idTokenVence: c.id_token_vence ?? null,
      };
      return cred;
    },

    guardarSesion: async (companyId, ambiente, s: Sesion) => {
      const { error } = await admin.rpc('ecf_guardar_sesion', {
        p_company: companyId,
        p_ambiente: ambiente,
        p_id_token: s.idToken,
        p_id_token_vence: s.idTokenVence,
        p_refresh_token: s.refreshToken,
        p_sub: s.sub,
      });
      if (error) throw new Error(`No se pudo guardar la sesión de MSeller: ${error.message}`);
    },

    registrar: async (id, cambio: CambioDocumento) => {
      const { error } = await admin
        .from('ecf_documentos')
        .update({ ...cambio, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(`No se pudo guardar el resultado del documento: ${error.message}`);
    },

    sumarUso: async (companyId, requests, comprobantes) => {
      const { error } = await admin.rpc('ecf_sumar_uso', {
        p_company: companyId,
        p_requests: requests,
        p_comprobantes: comprobantes,
      });
      if (error) throw new Error(`No se pudo sumar el uso del plan: ${error.message}`);
    },

    fetch,
    ahora: () => new Date(),
  };
}

/** Corre `tarea` sobre cada elemento, con a lo sumo `limite` a la vez. */
async function enParalelo<T>(items: T[], limite: number, tarea: (x: T) => Promise<void>) {
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (siguiente < items.length) {
      const x = items[siguiente++];
      await tarea(x);
    }
  });
  await Promise.all(trabajadores);
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'No autorizado.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Dos formas legítimas de llamar: el cron con la service role key, o un
    // usuario con sesión que pueda ver la venta o la nota.
    const esServicio = token === serviceKey;
    if (!esServicio) {
      const { data: quien, error: quienErr } = await admin.auth.getUser(token);
      if (quienErr || !quien?.user) return json(401, { error: 'Sesión inválida.' });
    }

    const body = await req.json().catch(() => null);
    const saleId = typeof body?.saleId === 'string' ? body.saleId : null;
    const creditNoteId = typeof body?.creditNoteId === 'string' ? body.creditNoteId : null;
    const documentoIds: unknown[] | null = Array.isArray(body?.documentoIds) ? body.documentoIds : null;

    const pedidos = [saleId, creditNoteId, documentoIds].filter((x) => x !== null).length;
    if (pedidos !== 1) {
      return json(400, { error: 'Solicitud inválida. Envía saleId, creditNoteId o documentoIds (uno solo).' });
    }

    const deps = crearDeps(admin);

    // --- Lote del cron: solo la service role --------------------------------
    if (documentoIds) {
      if (!esServicio) return json(403, { error: 'Solo el sistema puede procesar documentos por lote.' });
      const ids = documentoIds.filter((x): x is string => typeof x === 'string' && UUID.test(x));
      if (ids.length === 0 || ids.length !== documentoIds.length || ids.length > MAX_DOCUMENTOS) {
        return json(400, { error: `documentoIds debe traer entre 1 y ${MAX_DOCUMENTOS} identificadores válidos.` });
      }
      let procesados = 0;
      await enParalelo(ids, EN_PARALELO, async (id) => {
        try {
          const r = await emitirDocumento(id, deps);
          if (r.estado !== 'ocupado') procesados++;
        } catch (e) {
          // Un documento que no se pudo guardar no frena a los demás: queda
          // `enviando` y el cron lo retoma cuando venza su reserva.
          console.error('ecf-emitir: falló un documento del lote:', id, mensajeDe(e));
        }
      });
      return json(200, { procesados });
    }

    // --- Una venta o una nota de crédito -----------------------------------
    const origenId = saleId ?? creditNoteId!;
    if (!UUID.test(origenId)) return json(400, { error: 'Identificador inválido.' });

    if (!esServicio) {
      // La RLS decide quién ve qué: si el usuario no puede leer la venta o la
      // nota, tampoco puede emitir su comprobante.
      const usuario = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: visible, error: visibleErr } = await usuario
        .from(saleId ? 'sales' : 'credit_notes')
        .select('id')
        .eq('id', origenId)
        .maybeSingle();
      if (visibleErr) throw new Error(`No se pudo comprobar el acceso: ${visibleErr.message}`);
      if (!visible) {
        return json(404, {
          error: saleId
            ? 'No se encontró la venta, o no tienes acceso a ella.'
            : 'No se encontró la nota de crédito, o no tienes acceso a ella.',
        });
      }
    }

    // El documento vigente: el más reciente que nadie ha reemplazado.
    const buscar = () =>
      una<FilaDocumento>(
        admin
          .from('ecf_documentos')
          .select(COLUMNAS_DOCUMENTO)
          .eq(saleId ? 'sale_id' : 'credit_note_id', origenId)
          .is('reemplazado_por', null)
          .order('created_at', { ascending: false })
          .limit(1),
        'el documento',
      );
    const documento = await buscar();
    if (!documento) {
      return json(404, { error: 'Este comprobante no tiene un e-CF por emitir.' });
    }

    if (YA_RECIBIDOS.includes(documento.estado)) {
      // MSeller ya lo tiene: no se emite otra vez. Solo si un 2xx incompleto
      // dejó sin QR el documento se consulta una vez para llenarlo.
      if (!documento.qr_url) {
        await completarDocumento(
          {
            id: documento.id,
            companyId: documento.company_id,
            encf: documento.encf,
            ambiente: documento.ambiente as Ambiente,
            estado: documento.estado,
          },
          deps,
        );
      }
    } else if (POR_EMITIR.includes(documento.estado)) {
      // Si otro lo está enviando, o aún no toca el reintento, devuelve 'ocupado'
      // y se responde con el documento como esté.
      await emitirDocumento(documento.id, deps);
    }
    // rechazado, error_datos, sin_cupo: se devuelven como están (los reintenta una persona).

    const actual = (await buscar()) ?? documento;
    return json(200, { documento: actual });
  } catch (e) {
    // Solo llega aquí si falló la base: MSeller y sus errores ya quedaron
    // registrados en el documento. El mensaje no lleva secretos.
    console.error('ecf-emitir:', mensajeDe(e));
    return json(500, { error: 'No se pudo emitir el comprobante. Se reintentará solo.' });
  }
});
