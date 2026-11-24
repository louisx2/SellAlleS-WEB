// Reportes de vehículos (Motopréstamos): la cartera de unidades y las ventas del
// período. Lógica pura sobre lo que ya cargan la página y los providers.
import type { VehicleStatus } from './motos';

type VehiculoReporte = {
  status: VehicleStatus;
  saleId?: string;
  cost?: number;
  brand?: string;
  model?: string;
};

const ESTADOS: VehicleStatus[] = ['disponible', 'vendido', 'en_garantia', 'recuperado', 'liberado', 'baja'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export function carteraDeVehiculos(
  vehicles: VehiculoReporte[],
  saldoPorVenta: Map<string, { pendiente: number; atrasado: boolean }>,
) {
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<VehicleStatus, number>;
  let inventarioACosto = 0;
  const vendidosACuotas = { cantidad: 0, pendiente: 0, atrasados: 0 };

  for (const v of vehicles) {
    porEstado[v.status] += 1;
    if (v.status === 'disponible') inventarioACosto += v.cost ?? 0;
    const saldo = v.status === 'vendido' && v.saleId ? saldoPorVenta.get(v.saleId) : undefined;
    if (saldo && saldo.pendiente > 0) {
      vendidosACuotas.cantidad += 1;
      vendidosACuotas.pendiente = round2(vendidosACuotas.pendiente + saldo.pendiente);
      if (saldo.atrasado) vendidosACuotas.atrasados += 1;
    }
  }
  return { porEstado, inventarioACosto: round2(inventarioACosto), vendidosACuotas };
}

type VentaReporte = {
  id: string;
  createdAt: Date;
  paymentMethod: string;
  downPayment?: number;
  installments?: number;
  frequency?: string;
};

const modeloDe = (v: VehiculoReporte) => [v.brand, v.model].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || 'Sin modelo';

export function ventasDeVehiculos(vehicles: VehiculoReporte[], ventas: VentaReporte[], desde: Date, hasta: Date) {
  const ventaPorId = new Map(ventas.map((s) => [s.id, s]));
  const modelos = new Map<string, { modelo: string; contado: number; financiado: number }>();
  let contado = 0;
  let financiado = 0;
  const iniciales: number[] = [];
  const plazos: number[] = [];

  for (const v of vehicles) {
    const venta = v.saleId ? ventaPorId.get(v.saleId) : undefined;
    if (!venta || venta.createdAt < desde || venta.createdAt > hasta) continue;
    const esFinanciada = venta.paymentMethod === 'financing';
    const modelo = modeloDe(v);
    const fila = modelos.get(modelo) ?? { modelo, contado: 0, financiado: 0 };
    if (esFinanciada) {
      fila.financiado += 1;
      financiado += 1;
      iniciales.push(venta.downPayment ?? 0);
      if (venta.installments) plazos.push(venta.installments);
    } else {
      fila.contado += 1;
      contado += 1;
    }
    modelos.set(modelo, fila);
  }

  const promedio = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return {
    porModelo: [...modelos.values()].sort((a, b) => b.contado + b.financiado - (a.contado + a.financiado) || a.modelo.localeCompare(b.modelo)),
    contado,
    financiado,
    inicialPromedio: promedio(iniciales),
    plazoPromedio: promedio(plazos),
  };
}
