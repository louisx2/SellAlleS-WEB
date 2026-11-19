// Cálculos del reporte del taller. Lógica pura: recibe los casos, sus líneas y su
// historial ya leídos, y devuelve los números. Solo `import type`, para poder
// probarla con Node sin resolver imports de valores.
import type { ServiceEvent, ServiceItem, ServiceStatus } from './types';

export type CasoReporte = {
  id: string;
  number: number;
  status: ServiceStatus;
  assignedTo?: string;
  assignedName?: string;
  customerName?: string;
  customerPhone?: string;
  equipmentType?: string;
  equipment?: string;
  createdAt: Date;
  readyAt?: Date;
  deliveredAt?: Date;
  outcome?: 'repaired' | 'not_repaired';
  laborPrice: number;
  partsTotal: number;
  total: number;
  saleId?: string;
  warrantyOf?: string;
  warrantySale?: string;
  promisedAt?: Date;
};

export type Rango = { from: Date; to: Date };

const HORA = 3_600_000;
const DIA = 24 * HORA;
const ABIERTOS: ServiceStatus[] = ['received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair', 'ready', 'not_repaired'];
const LISTOS: ServiceStatus[] = ['ready', 'not_repaired'];

export const enRango = (d: Date | undefined, r: Rango) => !!d && d.getTime() >= r.from.getTime() && d.getTime() <= r.to.getTime();
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** "3.5 días" / "6 h": lo que se lee mejor según el tamaño. */
export function duracion(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < DIA) return `${Math.max(1, Math.round(ms / HORA))} h`;
  const d = ms / DIA;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} días`;
}

export type Resumen = {
  ingresados: number;
  entregados: number;
  enTaller: number;
  listos: number;
  listosViejos: number;
  atrasados: number;
  cobrados: number;
  facturado: number;
  manoDeObra: number;
  piezasVenta: number;
  piezasCosto: number;
  tiempoReparacion: number | null;
  tiempoEntrega: number | null;
  noReparados: number;
  garantias: number;
  rapidas: number;
};

/** El cobro que vale es el último 'charged' sin un 'charge_voided' después. */
export function fechaDeCobro(ev: ServiceEvent[]): Date | undefined {
  let fecha: Date | undefined;
  for (const e of [...ev].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (e.kind === 'charged') fecha = e.createdAt;
    if (e.kind === 'charge_voided') fecha = undefined;
  }
  return fecha;
}

export function resumen(
  casos: CasoReporte[], lineas: ServiceItem[], eventos: Map<string, ServiceEvent[]>, r: Rango,
  rapidas: Set<string>, ahora: Date = new Date(),
): Resumen {
  const cobradosEnRango = casos.filter((c) => c.saleId && enRango(fechaDeCobro(eventos.get(c.id) ?? []), r));
  const idsCobrados = new Set(cobradosEnRango.map((c) => c.id));
  const partes = lineas.filter((l) => l.kind === 'part' && idsCobrados.has(l.serviceId));
  const listosAhora = casos.filter((c) => LISTOS.includes(c.status));
  const entregados = casos.filter((c) => c.status === 'delivered' && enRango(c.deliveredAt, r));
  const listosEnRango = casos.filter((c) => enRango(c.readyAt, r));
  return {
    ingresados: casos.filter((c) => enRango(c.createdAt, r)).length,
    entregados: entregados.length,
    enTaller: casos.filter((c) => ABIERTOS.includes(c.status) && !LISTOS.includes(c.status)).length,
    listos: listosAhora.length,
    listosViejos: listosAhora.filter((c) => c.readyAt && ahora.getTime() - c.readyAt.getTime() > 7 * DIA).length,
    atrasados: casos.filter((c) => c.promisedAt && ABIERTOS.includes(c.status) && !LISTOS.includes(c.status)
      && c.promisedAt.getTime() < ahora.getTime()).length,
    cobrados: cobradosEnRango.length,
    facturado: cobradosEnRango.reduce((a, c) => a + c.total, 0),
    manoDeObra: cobradosEnRango.reduce((a, c) => a + c.laborPrice, 0),
    piezasVenta: cobradosEnRango.reduce((a, c) => a + c.partsTotal, 0),
    piezasCosto: partes.reduce((a, l) => a + l.cost * l.quantity, 0),
    tiempoReparacion: avg(listosEnRango.map((c) => c.readyAt!.getTime() - c.createdAt.getTime())),
    tiempoEntrega: avg(entregados.map((c) => c.deliveredAt!.getTime() - c.createdAt.getTime())),
    noReparados: entregados.filter((c) => c.outcome === 'not_repaired').length,
    garantias: casos.filter((c) => enRango(c.createdAt, r) && (c.warrantyOf || c.warrantySale)).length,
    rapidas: casos.filter((c) => enRango(c.createdAt, r) && rapidas.has(c.id)).length,
  };
}

export type FilaTecnico = {
  clave: string;
  nombre: string;
  asignados: number;
  terminados: number;
  enCurso: number;
  tiempoPromedio: number | null;
  manoDeObra: number;
  reingresos: number;
};

/** Por técnico, según quién tiene el caso ahora. `originales` resuelve de quién
 *  era el caso que volvió por garantía (puede ser de antes del período). */
export function porTecnico(
  casos: CasoReporte[], eventos: Map<string, ServiceEvent[]>, r: Rango,
  originales: Map<string, { assignedTo?: string }>,
): FilaTecnico[] {
  const filas = new Map<string, FilaTecnico>();
  const fila = (c: { assignedTo?: string; assignedName?: string }) => {
    const clave = c.assignedTo ?? 'sin';
    let f = filas.get(clave);
    if (!f) {
      f = { clave, nombre: c.assignedTo ? (c.assignedName ?? 'Sin nombre') : 'Sin asignar',
        asignados: 0, terminados: 0, enCurso: 0, tiempoPromedio: null, manoDeObra: 0, reingresos: 0 };
      filas.set(clave, f);
    }
    return f;
  };
  const tiempos = new Map<string, number[]>();
  for (const c of casos) {
    const f = fila(c);
    if (enRango(c.createdAt, r)) f.asignados += 1;
    if (enRango(c.readyAt, r)) {
      f.terminados += 1;
      tiempos.set(f.clave, [...(tiempos.get(f.clave) ?? []), c.readyAt!.getTime() - c.createdAt.getTime()]);
    }
    if (ABIERTOS.includes(c.status) && !LISTOS.includes(c.status)) f.enCurso += 1;
    if (c.saleId && enRango(fechaDeCobro(eventos.get(c.id) ?? []), r)) f.manoDeObra += c.laborPrice;
    if (c.warrantyOf && enRango(c.createdAt, r)) {
      const orig = originales.get(c.warrantyOf);
      if (orig?.assignedTo) {
        const del = filas.get(orig.assignedTo) ?? fila({ assignedTo: orig.assignedTo, assignedName: casos.find((x) => x.assignedTo === orig.assignedTo)?.assignedName });
        del.reingresos += 1;
      }
    }
  }
  for (const f of filas.values()) f.tiempoPromedio = avg(tiempos.get(f.clave) ?? []);
  return Array.from(filas.values())
    .filter((f) => f.asignados + f.terminados + f.enCurso + f.manoDeObra + f.reingresos > 0)
    .sort((a, b) => b.terminados - a.terminados || b.asignados - a.asignados);
}

/** Tiempo promedio que pasan los casos en cada estado. Cuenta los tramos que
 *  terminaron dentro del período (el estado actual de un caso abierto no cuenta). */
export function tiempoPorEstado(eventos: Map<string, ServiceEvent[]>, r: Rango): { estado: ServiceStatus; promedio: number; veces: number }[] {
  const tramos = new Map<ServiceStatus, number[]>();
  for (const evs of eventos.values()) {
    const cambios = evs
      .filter((e) => (e.kind === 'created' || e.kind === 'status') && e.toStatus)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < cambios.length - 1; i++) {
      const fin = cambios[i + 1].createdAt;
      if (!enRango(fin, r)) continue;
      const estado = cambios[i].toStatus!;
      tramos.set(estado, [...(tramos.get(estado) ?? []), fin.getTime() - cambios[i].createdAt.getTime()]);
    }
  }
  return Array.from(tramos.entries())
    .map(([estado, xs]) => ({ estado, promedio: avg(xs)!, veces: xs.length }))
    .sort((a, b) => b.promedio - a.promedio);
}

export type FilaConteo = { nombre: string; veces: number; cantidad: number; venta: number; costo: number };

/** Agrupa líneas por nombre (servicios del catálogo o piezas). */
export function topLineas(lineas: ServiceItem[], kind: 'labor' | 'part', casosEnRango: Set<string>): FilaConteo[] {
  const m = new Map<string, FilaConteo>();
  for (const l of lineas) {
    if (l.kind !== kind || !casosEnRango.has(l.serviceId)) continue;
    const nombre = l.product?.name || 'Sin nombre';
    const f = m.get(nombre) ?? { nombre, veces: 0, cantidad: 0, venta: 0, costo: 0 };
    f.veces += 1;
    f.cantidad += l.quantity;
    f.venta += l.price * l.quantity;
    f.costo += l.cost * l.quantity;
    m.set(nombre, f);
  }
  return Array.from(m.values()).sort((a, b) => b.veces - a.veces || b.venta - a.venta);
}

/** Equipos más reparados (marca y modelo) entre los casos que entraron en el período. */
export function topEquipos(casos: CasoReporte[], r: Rango): { nombre: string; veces: number }[] {
  const m = new Map<string, number>();
  for (const c of casos) {
    if (!enRango(c.createdAt, r)) continue;
    const nombre = (c.equipment || c.equipmentType || 'Sin especificar').trim();
    m.set(nombre, (m.get(nombre) ?? 0) + 1);
  }
  return Array.from(m.entries()).map(([nombre, veces]) => ({ nombre, veces })).sort((a, b) => b.veces - a.veces);
}
