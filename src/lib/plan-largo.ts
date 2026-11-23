// Planes de muchas cuotas (hasta 312 en cobro diario) no caben en un ticket
// térmico. Hasta 24 cuotas se imprimen todas; con más, solo las próximas sin
// pagar y cuántas quedan fuera.

const CABEN_EN_EL_TICKET = 24;

export function cuotasParaTicket<T extends { status: string }>(
  cuotas: T[],
  max = 12,
): { mostrar: T[]; restantes: number } {
  if (cuotas.length <= CABEN_EN_EL_TICKET) return { mostrar: cuotas, restantes: 0 };
  const sinPagar = cuotas.filter((c) => c.status !== 'paid');
  return { mostrar: sinPagar.slice(0, max), restantes: Math.max(sinPagar.length - max, 0) };
}
