// =============================================================================
// MODO SOLO FACTURACIÓN
// -----------------------------------------------------------------------------
// Una empresa entra en él por uno de dos motivos:
//  - prueba_vencida: la prueba gratis terminó y no ha pagado (automático).
//  - cuotas: el super admin la pasó a "solo ventas" desde Cobros por atraso.
//
// En los dos casos la empresa solo puede facturar: el menú se reduce al
// Carrito, Movimientos, la Caja y Mi Suscripción, el resto de las pantallas
// muestra un aviso, y el cliente de Supabase rechaza las escrituras que no son
// vender, cobrar, usar la caja o pagar la suscripción. El super admin nunca
// queda en este modo.
//
// Es una barrera de interfaz, no de seguridad: la base no lo hace cumplir.
//
// Lógica pura y sin imports de valor: la prueban scripts/tests/bloqueo.test.mjs
// con `node --test`, que importa este archivo quitándole los tipos.
// =============================================================================

export type MotivoBloqueo = 'prueba_vencida' | 'cuotas';

export function motivoDeBloqueo(e: {
  esSuperAdmin: boolean;
  estado?: string | null;
  finPrueba?: string | null;
  soloVentas: boolean;
  ahora?: number;
}): MotivoBloqueo | null {
  if (e.esSuperAdmin) return null;
  const ahora = e.ahora ?? Date.now();
  if (e.estado === 'trial' && e.finPrueba && new Date(e.finPrueba).getTime() < ahora) return 'prueba_vencida';
  if (e.soloVentas) return 'cuotas';
  return null;
}

/** Lo que se le dice al usuario cuando intenta algo que el bloqueo no deja. */
export const MENSAJE_BLOQUEO: Record<MotivoBloqueo, string> = {
  prueba_vencida:
    'Su período de prueba ha finalizado. Para continuar utilizando todas las funciones de SellAlleS, realice el pago de su suscripción. Mientras tanto, solo está disponible la facturación.',
  cuotas:
    'Su cuenta presenta pagos pendientes. Para restablecer todas las funciones, regularice el pago de su suscripción. Mientras tanto, solo está disponible la facturación.',
};

/** Título corto del aviso, para encabezados y la pantalla de función no disponible. */
export const TITULO_BLOQUEO: Record<MotivoBloqueo, string> = {
  prueba_vencida: 'Su período de prueba ha finalizado',
  cuotas: 'Su cuenta presenta pagos pendientes',
};

/** La segunda frase del aviso superior; la primera es el título. */
export const AVISO_BLOQUEO: Record<MotivoBloqueo, string> = {
  prueba_vencida: 'Para continuar utilizando todas las funciones de SellAlleS, realice el pago de su suscripción.',
  cuotas: 'Para restablecer todas las funciones, regularice el pago de su suscripción.',
};

/** Pantallas que siguen abiertas: facturar, ver lo facturado, la caja y pagar. */
export const RUTAS_EN_BLOQUEO = ['/pos', '/sales', '/caja', '/suscripcion'] as const;

export function rutaPermitidaEnBloqueo(pathname: string): boolean {
  return RUTAS_EN_BLOQUEO.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** RPC que solo leen: no se frenan nunca. */
const RPC_DE_LECTURA = new Set([
  'mi_cuenta_de_suscripcion', 'get_my_admin_companies', 'get_consolidated_dashboard',
  'buscar_en_otras_sucursales', 'company_branch_user_counts', 'articulos_rapidos_recientes',
  // El checkout las necesita para saber qué comprobante emitir.
  'ecf_activa', 'ncf_b_vigente',
]);

/** Pagar la suscripción siempre se puede: es justo lo que saca del bloqueo. */
const RPC_DE_SUSCRIPCION = new Set(['reportar_pago_de_suscripcion', 'anular_reporte_de_pago']);

/** Lo que sigue funcionando en bloqueo: vender, cobrar, la caja, y
 *  reintentar o reemitir el e-CF de una venta (sin eso la factura no sale). */
const RPC_DE_FACTURACION = new Set([
  'create_sale_with_items', 'redeem_coupon', 'register_sale_payment', 'register_customer_payment',
  'register_loan_payment', 'open_caja_session', 'close_caja_session', 'register_caja_movement',
  'ecf_reintentar', 'reemitir_ecf',
]);

/** Escrituras directas que siguen: el cliente nuevo que se crea al vender.
 *  Cotizaciones y servicios quedan dentro por si una venta los toca, aunque
 *  sus pantallas no se vean. */
const TABLAS_DE_FACTURACION: Record<string, Set<string>> = {
  customers: new Set(['insert', 'update']),
  quotes: new Set(['insert', 'update']),
  quote_items: new Set(['insert', 'delete']),
  services: new Set(['insert', 'update']),
  service_items: new Set(['insert', 'delete']),
};

/** null si la escritura pasa; si no, el mensaje con el que se rechaza. */
export function escrituraBloqueada(motivo: MotivoBloqueo | null, tabla: string, metodo: string): string | null {
  if (!motivo) return null;
  return TABLAS_DE_FACTURACION[tabla]?.has(metodo) ? null : MENSAJE_BLOQUEO[motivo];
}

/** null si la RPC pasa; si no, el mensaje con el que se rechaza. */
export function rpcBloqueada(motivo: MotivoBloqueo | null, fn: string): string | null {
  if (!motivo) return null;
  if (RPC_DE_LECTURA.has(fn) || RPC_DE_SUSCRIPCION.has(fn) || RPC_DE_FACTURACION.has(fn)) return null;
  return MENSAJE_BLOQUEO[motivo];
}
