// Antigüedad de cartera: cuánto se debe por cliente, repartido en tramos de
// días de atraso. Junta préstamos, financiamientos y crédito simple. Los tramos
// cortos al principio son para negocios que cobran por semana o por día.

export type Tramo = 'al_dia' | 'd1_7' | 'd8_15' | 'd16_30' | 'd31_60' | 'd61_90' | 'd90_mas';

export const TRAMOS: { key: Tramo; label: string }[] = [
  { key: 'al_dia', label: 'Al día' },
  { key: 'd1_7', label: '1–7' },
  { key: 'd8_15', label: '8–15' },
  { key: 'd16_30', label: '16–30' },
  { key: 'd31_60', label: '31–60' },
  { key: 'd61_90', label: '61–90' },
  { key: 'd90_mas', label: '+90' },
];

export function tramoDe(diasAtraso: number): Tramo {
  if (diasAtraso <= 0) return 'al_dia';
  if (diasAtraso <= 7) return 'd1_7';
  if (diasAtraso <= 15) return 'd8_15';
  if (diasAtraso <= 30) return 'd16_30';
  if (diasAtraso <= 60) return 'd31_60';
  if (diasAtraso <= 90) return 'd61_90';
  return 'd90_mas';
}

export interface CuentaCartera {
  id: string;
  tipo: 'prestamo' | 'financiamiento' | 'credito';
  clienteId: string;
  cliente: string;
  telefono: string;
  saldo: number;
  /** Días desde la cuota vencida más vieja; null = crédito simple sin plan de cuotas. */
  diasAtraso: number | null;
}

export interface FilaCartera {
  clienteId: string;
  cliente: string;
  telefono: string;
  porTramo: Record<Tramo, number>;
  sinPlan: number;
  total: number;
  diasMax: number;
}

export type TotalesCartera = Record<Tramo, number> & { sinPlan: number; total: number; vencido: number };

const ceros = (): Record<Tramo, number> =>
  Object.fromEntries(TRAMOS.map((t) => [t.key, 0])) as Record<Tramo, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function agruparCartera(cuentas: CuentaCartera[]): { filas: FilaCartera[]; totales: TotalesCartera } {
  const porCliente = new Map<string, FilaCartera>();

  for (const c of cuentas) {
    if (!(c.saldo > 0)) continue;
    let fila = porCliente.get(c.clienteId);
    if (!fila) {
      fila = { clienteId: c.clienteId, cliente: c.cliente, telefono: c.telefono, porTramo: ceros(), sinPlan: 0, total: 0, diasMax: 0 };
      porCliente.set(c.clienteId, fila);
    }
    if (c.diasAtraso === null) {
      fila.sinPlan = round2(fila.sinPlan + c.saldo);
    } else {
      const t = tramoDe(c.diasAtraso);
      fila.porTramo[t] = round2(fila.porTramo[t] + c.saldo);
      fila.diasMax = Math.max(fila.diasMax, c.diasAtraso);
    }
    fila.total = round2(fila.total + c.saldo);
  }

  const filas = [...porCliente.values()].sort((a, b) => b.diasMax - a.diasMax || b.total - a.total);

  const totales = { ...ceros(), sinPlan: 0, total: 0, vencido: 0 } as TotalesCartera;
  for (const f of filas) {
    for (const t of TRAMOS) totales[t.key] = round2(totales[t.key] + f.porTramo[t.key]);
    totales.sinPlan = round2(totales.sinPlan + f.sinPlan);
    totales.total = round2(totales.total + f.total);
  }
  totales.vencido = round2(totales.total - totales.al_dia - totales.sinPlan);

  return { filas, totales };
}
