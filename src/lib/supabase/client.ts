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
// MODO SOLO-LECTURA (prueba de 14 días vencida)
// -----------------------------------------------------------------------------
// Cuando la empresa queda en solo-lectura, bloqueamos toda escritura desde un
// único lugar: interceptamos insert/update/delete/upsert y rpc del cliente
// (todas las rpc del cliente son de escritura: pagos, caja, cupón). El
// auth-provider activa/desactiva este modo al cargar el perfil. El super admin
// nunca queda en solo-lectura, así que puede gestionar/reactivar empresas.
// Es una barrera de UI (no de seguridad); el objetivo es que el usuario en
// prueba vencida no pueda modificar datos hasta activar su cuenta.
// =============================================================================
// Sin número de contacto: este string vive fuera de React y no puede leer
// platform_settings. El canal vigente lo muestra la UI (banner superior,
// pantalla de suspensión, botón de Soporte), que sí lee el provider.
export const READONLY_MESSAGE =
  'Tu prueba gratis de 14 días terminó. Activa tu cuenta desde el botón de Soporte para seguir registrando o modificando datos.';

let readOnlyMode = false;
export function setReadOnlyMode(value: boolean) { readOnlyMode = value; }

const WRITE_METHODS = new Set(['insert', 'update', 'delete', 'upsert']);

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
          if (readOnlyMode) throw new Error(READONLY_MESSAGE);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
};

const rawRpc = client.rpc.bind(supabase);
client.rpc = (fn: string, args?: unknown, options?: unknown) => {
  if (readOnlyMode) return Promise.reject(new Error(READONLY_MESSAGE));
  return rawRpc(fn, args, options);
};
