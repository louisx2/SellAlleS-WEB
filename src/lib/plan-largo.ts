// Planes de muchas cuotas (hasta 312 en cobro diario) no caben en un ticket
// térmico ni se leen bien en una tabla. Hasta 24 cuotas se muestran todas.

const CABEN = 24;

/**
 * Ticket térmico: con más de 24 cuotas, solo las próximas `max` sin pagar y
 * cuántas quedan fuera. Un plan ya saldado (sin cuotas pendientes) va completo:
 * es el registro de lo que se pagó.
 */
export function cuotasParaTicket<T extends { status: string }>(
  cuotas: T[],
  max = 12,
): { mostrar: T[]; restantes: number } {
  if (cuotas.length <= CABEN) return { mostrar: cuotas, restantes: 0 };
  const sinPagar = cuotas.filter((c) => c.status !== 'paid');
  if (sinPagar.length === 0) return { mostrar: cuotas, restantes: 0 };
  return { mostrar: sinPagar.slice(0, max), restantes: Math.max(sinPagar.length - max, 0) };
}

/**
 * Tabla de cuotas en pantalla: `n` filas desde la próxima a cobrar (corridas
 * hacia atrás si al final no alcanzan), para que en un plan diario avanzado la
 * cuota de hoy no quede escondida detrás de las ya pagadas.
 */
export function ventanaDeCuotas<T extends { status: string }>(
  cuotas: T[],
  n = CABEN,
): { visibles: T[]; ocultas: number } {
  if (cuotas.length <= n) return { visibles: cuotas, ocultas: 0 };
  const primera = cuotas.findIndex((c) => c.status !== 'paid');
  const desde = Math.max(Math.min(primera === -1 ? 0 : primera, cuotas.length - n), 0);
  return { visibles: cuotas.slice(desde, desde + n), ocultas: cuotas.length - n };
}
