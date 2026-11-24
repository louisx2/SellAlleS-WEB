// Motopréstamos: etiquetas, descripción y búsqueda de vehículos. Lógica pura:
// la usan la lista, la ficha, el POS y los reportes.

export type VehicleStatus = 'disponible' | 'vendido' | 'en_garantia' | 'recuperado' | 'liberado' | 'baja';
export type VehicleOrigin = 'inventario' | 'garantia';
export type VehicleCondition = 'nuevo' | 'usado';
export type RegistrationStatus = 'en_custodia' | 'lista_para_entregar' | 'entregada' | 'no_aplica';

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; badge: string }> = {
  disponible:  { label: 'Disponible',  badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100' },
  vendido:     { label: 'Vendido',     badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100' },
  en_garantia: { label: 'En garantía', badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100' },
  recuperado:  { label: 'Recuperado',  badge: 'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100' },
  liberado:    { label: 'Liberado',    badge: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100' },
  baja:        { label: 'De baja',     badge: 'bg-muted text-muted-foreground line-through' },
};

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  en_custodia: 'En custodia',
  lista_para_entregar: 'Lista para entregar',
  entregada: 'Entregada',
  no_aplica: 'No aplica',
};

type Describible = {
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  chassis?: string | null;
  engineNumber?: string | null;
};

const limpio = (s?: string | null) => (s ?? '').trim();

/** "Honda CG 150 · 2025 · Roja": para listas y selectores. */
export function vehicleLabel(v: Describible): string {
  const nombre = [limpio(v.brand), limpio(v.model)].filter(Boolean).join(' ');
  const partes = [nombre, v.year ? String(v.year) : '', limpio(v.color)].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Vehículo';
}

/**
 * La descripción de la línea de venta, con chasis y motor. Espejo EXACTO de
 * `motos_descripcion` en la base, que es la que queda en la factura.
 */
export function vehicleLineName(v: Describible): string {
  const nombre = [limpio(v.brand), limpio(v.model)].filter(Boolean).join(' ');
  return [
    nombre,
    v.year ? String(v.year) : '',
    limpio(v.color),
    limpio(v.chassis) ? `Chasis ${limpio(v.chassis)}` : '',
    limpio(v.engineNumber) ? `Motor ${limpio(v.engineNumber)}` : '',
  ].filter(Boolean).join(' · ');
}

/** Como el índice único de la base: sin espacios y en mayúsculas. */
export function normalizeChassis(s: string): string {
  return s.replace(/\s/g, '').toUpperCase();
}

const paraBuscar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Búsqueda en chasis, placa, marca, modelo, color y cliente (sin tildes ni signos). */
export function matchesVehicle(
  v: Describible & { plate?: string | null; customerName?: string | null },
  q: string,
): boolean {
  const aguja = paraBuscar(q);
  if (!aguja) return true;
  const pajar = paraBuscar(
    [v.chassis, v.plate, v.brand, v.model, v.color, v.customerName, v.engineNumber].map(limpio).join(' '),
  );
  return pajar.includes(aguja);
}
