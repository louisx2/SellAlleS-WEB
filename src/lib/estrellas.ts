// Cliente estrella y producto estrella: quién compra más y qué se vende más.
//
// Las dos cuentas salen de una lista de ventas ya filtrada por período y
// sucursal; aquí solo se descartan las anuladas y se suma. Las usan los
// reportes (con las ventas del rango pedidas a la base), el dashboard y la
// lista de clientes (con las que ya tiene el provider).
import type { Sale } from '@/lib/types';
import { isUuid } from '@/lib/utils';
import { roundQty } from '@/lib/units';
import { topProductKey } from '@/lib/quick-sales';
import { lineBaseQty } from '@/lib/presentations';

/** Cuántos clientes llevan la estrella en la lista de clientes. */
export const TOP_ESTRELLAS = 3;
/** Ventana de la estrella de la lista de clientes, en días. */
export const DIAS_ESTRELLA = 90;

export type ClienteEstrella = {
  customerId: string;
  nombre: string;
  compras: number;
  /** Lo que pagó, con ITBIS: es lo que el negocio le facturó. */
  monto: number;
  ticketPromedio: number;
  ultimaCompra: Date;
};

export type ProductoEstrella = {
  key: string;
  nombre: string;
  isQuick: boolean;
  /** En la unidad base del producto (2 paquetes de 12 son 24). */
  cantidad: number;
  /** Cantidad × precio cobrado en la línea (sin el ITBIS que se suma aparte). */
  ingresos: number;
  unidad?: string;
};

export type OrdenProductos = 'ingresos' | 'cantidad';

const vigentes = (sales: Sale[]) => sales.filter((s) => !s.cancelledAt);

/**
 * Clientes ordenados por lo que compraron. El Cliente Genérico (id '0' o venta
 * sin cliente) no compite: no es una persona.
 */
export function rankingClientes(sales: Sale[]): ClienteEstrella[] {
  const map = new Map<string, ClienteEstrella>();
  for (const s of vigentes(sales)) {
    const id = s.customerId;
    if (!id || !isUuid(id)) continue;
    const acc = map.get(id) ?? {
      customerId: id,
      nombre: s.customer?.name ?? 'Cliente',
      compras: 0,
      monto: 0,
      ticketPromedio: 0,
      ultimaCompra: s.createdAt,
    };
    acc.compras += 1;
    acc.monto += s.total;
    if (s.createdAt > acc.ultimaCompra) {
      acc.ultimaCompra = s.createdAt;
      // El nombre de la venta más reciente: si lo corrigieron, gana el nuevo.
      if (s.customer?.name) acc.nombre = s.customer.name;
    }
    map.set(id, acc);
  }
  return Array.from(map.values())
    .map((c) => ({ ...c, ticketPromedio: c.compras > 0 ? c.monto / c.compras : 0 }))
    .sort((a, b) => b.monto - a.monto || b.compras - a.compras);
}

/**
 * Productos ordenados por ingreso (por defecto) o por cantidad. Ordenar por
 * cantidad compara libras con cajas; por ingreso no tiene ese problema.
 * `nombreActual` da el nombre de hoy del catálogo (pudo renombrarse).
 */
export function rankingProductos(
  sales: Sale[],
  orden: OrdenProductos = 'ingresos',
  nombreActual?: (productId: string) => string | undefined,
): ProductoEstrella[] {
  const map = new Map<string, ProductoEstrella>();
  for (const sale of vigentes(sales)) {
    for (const item of sale.items) {
      // Las rápidas se agrupan por descripción normalizada; las del legacy sin
      // producto emparejado, por nombre (si no, todas caerían en una sola fila).
      const key = topProductKey(item) || `sin-id:${item.product.name}`;
      const acc = map.get(key) ?? {
        key,
        nombre: item.product.name,
        isQuick: !!item.isQuick,
        cantidad: 0,
        ingresos: 0,
        unidad: item.product.unit,
      };
      const precio = item.customPrice ?? item.product.price;
      acc.cantidad = roundQty(acc.cantidad + lineBaseQty(item));
      acc.ingresos += precio * item.quantity;
      acc.unidad = acc.unidad ?? item.product.unit;
      map.set(key, acc);
    }
  }
  return Array.from(map.values())
    .map((p) => ({ ...p, nombre: (!p.isQuick && nombreActual?.(p.key)) || p.nombre }))
    .sort((a, b) =>
      orden === 'cantidad'
        ? b.cantidad - a.cantidad || b.ingresos - a.ingresos
        : b.ingresos - a.ingresos || b.cantidad - a.cantidad,
    );
}

/** Ventas desde `desde` (incluido) hasta ahora. */
export function ventasDesde(sales: Sale[], desde: Date): Sale[] {
  return sales.filter((s) => s.createdAt >= desde);
}

export function inicioDeMes(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function haceDias(dias: number, d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - dias);
  return x;
}

/** Ids de los clientes con estrella: los TOP_ESTRELLAS que más compraron en los últimos DIAS_ESTRELLA días. */
export function idsClientesEstrella(sales: Sale[]): Set<string> {
  const top = rankingClientes(ventasDesde(sales, haceDias(DIAS_ESTRELLA)))
    .filter((c) => c.monto > 0)
    .slice(0, TOP_ESTRELLAS);
  return new Set(top.map((c) => c.customerId));
}
