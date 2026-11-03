// Las llamadas a la base que comparten las Edge Functions de e-CF (ecf-emitir,
// ecf-estado y ecf-admin): leer las credenciales de MSeller de una empresa,
// guardar la sesión que se abrió y sumar lo gastado del plan.
//
// Módulo puro: recibe el cliente de Supabase (con la service role) como
// parámetro y solo importa tipos, así las pruebas de `npm test` (Node, que carga
// los .ts quitando los tipos) lo ejercitan con un cliente falso. Por eso solo usa
// sintaxis borrable (nada de enum, namespace ni parameter properties).
//
// Los mensajes de error no incluyen lo que se leyó ni lo que se iba a guardar:
// viajan a `ultimo_error` de un documento, al registro de la función o a la
// respuesta del panel, y los secretos no pueden salir por ninguno de esos lados.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Ambiente, Credenciales, Sesion } from './mseller.ts';

/** Lo único que se usa del cliente: las RPC del servidor. */
export type ClienteRpc = Pick<SupabaseClient, 'rpc'>;

/**
 * Del jsonb que devuelve `ecf_leer_credenciales` (llaves en snake_case) a las
 * credenciales que usa el cliente de MSeller. Lanza si la empresa no tiene
 * credenciales guardadas en ese ambiente o si les falta algo imprescindible.
 */
export function credencialesDesde(data: unknown, ambiente: Ambiente): Credenciales {
  if (!data) throw new Error(`La empresa no tiene credenciales de MSeller guardadas para ${ambiente}.`);
  const c = data as Record<string, string | null>;
  if (!c.email || !c.password || !c.api_key) {
    throw new Error(`Las credenciales de MSeller de ${ambiente} están incompletas.`);
  }
  return {
    email: c.email,
    password: c.password,
    apiKey: c.api_key,
    refreshToken: c.refresh_token ?? null,
    sub: c.sub ?? null,
    idToken: c.id_token ?? null,
    idTokenVence: c.id_token_vence ?? null,
  };
}

/** Las credenciales de la empresa en ese ambiente (descifradas por la base; solo para usarlas en memoria). */
export async function leerCredenciales(
  db: ClienteRpc,
  companyId: string,
  ambiente: Ambiente,
): Promise<Credenciales> {
  const { data, error } = await db.rpc('ecf_leer_credenciales', {
    p_company: companyId,
    p_ambiente: ambiente,
  });
  if (error) throw new Error(`No se pudieron leer las credenciales de MSeller: ${error.message}`);
  return credencialesDesde(data, ambiente);
}

/** Guarda la sesión abierta con MSeller (el refresh token va a Vault; la base conserva el anterior si llega null). */
export async function guardarSesion(
  db: ClienteRpc,
  companyId: string,
  ambiente: Ambiente,
  s: Sesion,
): Promise<void> {
  const { error } = await db.rpc('ecf_guardar_sesion', {
    p_company: companyId,
    p_ambiente: ambiente,
    p_id_token: s.idToken,
    p_id_token_vence: s.idTokenVence,
    p_refresh_token: s.refreshToken,
    p_sub: s.sub,
  });
  if (error) throw new Error(`No se pudo guardar la sesión de MSeller: ${error.message}`);
}

/** Suma lo gastado del plan de MSeller (requests y comprobantes) en el mes en curso. */
export async function sumarUso(
  db: ClienteRpc,
  companyId: string,
  requests: number,
  comprobantes: number,
): Promise<void> {
  const { error } = await db.rpc('ecf_sumar_uso', {
    p_company: companyId,
    p_requests: requests,
    p_comprobantes: comprobantes,
  });
  if (error) throw new Error(`No se pudo sumar el uso del plan: ${error.message}`);
}
