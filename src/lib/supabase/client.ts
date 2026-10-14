import { createClient } from '@supabase/supabase-js';

// =============================================================================
// CLIENTE SUPABASE (scaffolding)
// -----------------------------------------------------------------------------
// Aún no se usa en la app: los providers funcionan con datos en memoria.
// Cuando creemos el proyecto Supabase y el esquema (con empresa_id + RLS):
//   1. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local
//   2. Reemplaza el estado en memoria de los providers por consultas a este cliente.
//   3. Reemplaza la autenticación local (auth-provider.tsx) por supabase.auth.
// =============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Impersonación: cuando el super admin "entra" a una empresa, guardamos su id en
// localStorage y disparamos un reload completo. Al recrearse este módulo, horneamos
// el id como cabecera x-impersonate-company; RLS la usa (solo si el usuario es un
// super admin real) para tratar al super admin como miembro de esa empresa, dejando
// las pantallas del tenant correctamente aisladas. Sin impersonar, no se envía nada
// y el super admin conserva su acceso de plataforma.
const impersonatedCompany =
  typeof window !== 'undefined' ? window.localStorage.getItem('userImpersonatedCompany') : null;

/** Lo que se horneó al cargar este módulo, para que el resto de la app pueda
 *  detectar que ya no corresponde. Al iniciar sesión no puede haber ninguna
 *  impersonación en curso: si esto trae valor, viene de la sesión anterior y
 *  hay que rehacer el módulo con una recarga dura. */
export const cabeceraImpersonacionHorneada = impersonatedCompany;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  impersonatedCompany
    ? { global: { headers: { 'x-impersonate-company': impersonatedCompany } } }
    : undefined,
);

// La cabecera se le quita al cliente de Edge Functions y se le deja al de datos.
//
// A las funciones no les sirve: usan service role y resuelven permisos leyendo
// profiles por su cuenta. A quien le sirve es a RLS, que la lee vía
// impersonated_company_id() en las consultas normales.
//
// Y mandársela las ROMPE, todas: el preflight CORS de cada función declara una
// lista fija de cabeceras permitidas que no la incluye, así que el navegador
// bloquea la petición real. En el log del servidor se ve el OPTIONS y ningún
// POST, y al usuario le llega un "Failed to send a request to the Edge Function"
// que no explica nada. Estando dentro de una empresa fallaban por igual el envío
// de facturas por correo, el enlace de WhatsApp, los tickets de soporte y el
// resumen de caja.
//
// Se arregla aquí y no en las 22 funciones porque es un solo sitio, cubre
// también las que no están en este repo, y no hay que volver a acordarse al
// escribir la próxima.
if (impersonatedCompany) {
  const clienteFunciones = supabase.functions as unknown as { headers?: Record<string, string> };
  if (clienteFunciones.headers) delete clienteFunciones.headers['x-impersonate-company'];
}

// =============================================================================
// MODO SOLO-LECTURA (prueba vencida) Y MODO SOLO VENTAS (atraso en la cuota)
// -----------------------------------------------------------------------------
// Las dos barreras viven en un único lugar: interceptamos insert/update/
// delete/upsert y rpc del cliente. El auth-provider las activa/desactiva al
// cargar el perfil. El super admin nunca queda en ninguna, así que puede
// gestionar/reactivar empresas.
//
// - Solo lectura: la prueba terminó. Puede entrar y ver, no modificar.
// - Solo ventas: el super admin la puso a mano desde Cobros por atraso. Sigue
//   vendiendo, cobrando, usando la caja, las cotizaciones y los servicios;
//   inventario, usuarios, configuración, gastos y lo demás quedan en consulta.
//
// En las dos se puede reportar el pago de la suscripción: es justo lo que la
// empresa necesita hacer para salir de ahí.
//
// Es una barrera de UI (no de seguridad), igual que antes.
// =============================================================================
// Sin número de contacto: este string vive fuera de React y no puede leer
// platform_settings. El canal vigente lo muestra la UI (banner superior,
// pantalla de suspensión, botón de Soporte), que sí lee el provider.
export const READONLY_MESSAGE =
  'Tu prueba gratis terminó. Activa tu cuenta desde Mi Suscripción o el botón de Soporte para seguir registrando o modificando datos.';

export const SOLO_VENTAS_MESSAGE =
  'Tu cuenta está en modo solo ventas por cuotas pendientes: puedes vender, cobrar y usar la caja. Para lo demás, ponte al día desde Mi Suscripción.';

let readOnlyMode = false;
export function setReadOnlyMode(value: boolean) { readOnlyMode = value; }

let soloVentasMode = false;
export function setSoloVentasMode(value: boolean) { soloVentasMode = value; }

const WRITE_METHODS = new Set(['insert', 'update', 'delete', 'upsert']);

/** RPC que solo leen: no se bloquean en ningún modo. */
const RPC_DE_LECTURA = new Set([
  'mi_cuenta_de_suscripcion', 'get_my_admin_companies', 'get_consolidated_dashboard',
  'buscar_en_otras_sucursales', 'company_branch_user_counts',
]);

/** Pagar la suscripción siempre se puede. */
const RPC_DE_SUSCRIPCION = new Set(['reportar_pago_de_suscripcion', 'anular_reporte_de_pago']);

/** Lo que sigue funcionando en solo ventas: vender, cobrar y la caja. */
const RPC_SOLO_VENTAS = new Set([
  'create_sale_with_items', 'redeem_coupon', 'register_sale_payment', 'register_customer_payment',
  'register_loan_payment', 'open_caja_session', 'close_caja_session', 'register_caja_movement',
]);

/** Escrituras directas que siguen en solo ventas: el cliente nuevo en la
 *  venta, y cotizaciones y órdenes de servicio, que también son vender. */
const TABLAS_SOLO_VENTAS: Record<string, Set<string>> = {
  customers: new Set(['insert', 'update']),
  quotes: new Set(['insert', 'update']),
  quote_items: new Set(['insert', 'delete']),
  services: new Set(['insert', 'update']),
  service_items: new Set(['insert', 'delete']),
};

function bloqueoDeEscritura(relation: string, method: string): string | null {
  if (readOnlyMode) return READONLY_MESSAGE;
  if (soloVentasMode && !TABLAS_SOLO_VENTAS[relation]?.has(method)) return SOLO_VENTAS_MESSAGE;
  return null;
}

function bloqueoDeRpc(fn: string): string | null {
  if (RPC_DE_LECTURA.has(fn) || RPC_DE_SUSCRIPCION.has(fn)) return null;
  if (readOnlyMode) return READONLY_MESSAGE;
  if (soloVentasMode && !RPC_SOLO_VENTAS.has(fn)) return SOLO_VENTAS_MESSAGE;
  return null;
}

// Reasignamos from/rpc sobre el cliente (casteado a any para evitar pelear con
// las firmas genéricas de supabase-js; el comportamiento en runtime no cambia).
const client = supabase as unknown as {
  from: (r: string) => unknown;
  rpc: (fn: string, args?: unknown, options?: unknown) => unknown;
};

const rawFrom = client.from.bind(supabase);
client.from = (relation: string) => {
  const builder = rawFrom(relation) as object;
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && WRITE_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const bloqueo = bloqueoDeEscritura(relation, prop);
          if (bloqueo) throw new Error(bloqueo);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
};

const rawRpc = client.rpc.bind(supabase);
client.rpc = (fn: string, args?: unknown, options?: unknown) => {
  const bloqueo = bloqueoDeRpc(fn);
  if (bloqueo) return Promise.reject(new Error(bloqueo));
  return rawRpc(fn, args, options);
};
