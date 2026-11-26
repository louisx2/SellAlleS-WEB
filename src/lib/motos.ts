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
 * `motos_descripcion` en la base, que es la que queda en la factura. Chasis y
 * motor van antes que año y color: el e-CF corta el nombre a 80 caracteres.
 */
export function vehicleLineName(v: Describible): string {
  const nombre = [limpio(v.brand), limpio(v.model)].filter(Boolean).join(' ');
  return [
    nombre,
    limpio(v.chassis) ? `Chasis ${limpio(v.chassis)}` : '',
    limpio(v.engineNumber) ? `Motor ${limpio(v.engineNumber)}` : '',
    v.year ? String(v.year) : '',
    limpio(v.color),
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

/** Un monto escrito a mano: acepta comas de miles ("95,000"). Vacío = undefined;
 *  lo que no sea un número válido, negativo o con coma decimal = NaN. */
export function parseMonto(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t.replace(/,/g, ''));
}

/** Por qué no se puede marcar todavía un artículo como vehículo. La base lo
 *  rechaza igual; esto lo dice antes y con los pasos, porque con el interruptor
 *  encendido el formulario esconde las existencias y las presentaciones. */
export function motivoParaNoMarcarVehiculo(p: {
  eraVehiculo: boolean; esVehiculo: boolean; stock: number; presentaciones: number;
}): string | null {
  if (p.eraVehiculo || !p.esVehiculo) return null;
  if (p.stock !== 0) {
    return `Tiene ${p.stock} en existencias. Apaga «Es un vehículo», pon las existencias en 0 y guarda; después márcalo e ingresa cada moto desde Vehículos.`;
  }
  if (p.presentaciones > 0) return 'Tiene presentaciones. Apaga «Es un vehículo», quítalas y guarda; después márcalo.';
  return null;
}

/** Selector de chasis del POS: las unidades disponibles del artículo que no están
 *  ya en un carrito y coinciden con la búsqueda. Si no queda ninguna, `aviso` dice
 *  por qué: no hay, están todas en carritos, o la búsqueda no encuentra. */
export function unidadesParaElegir<
  V extends Describible & { id: string; productId?: string | null; status: VehicleStatus; plate?: string | null },
>(vehicles: V[], product: { id: string; name: string }, enCarritos: Set<string>, q: string): { opciones: V[]; aviso: string | null } {
  const disponibles = vehicles.filter((v) => v.productId === product.id && v.status === 'disponible');
  const libres = disponibles.filter((v) => !enCarritos.has(v.id));
  const opciones = libres.filter((v) => matchesVehicle(v, q));
  if (opciones.length > 0) return { opciones, aviso: null };
  if (disponibles.length === 0) return { opciones, aviso: `No hay unidades disponibles de ${product.name}. Ingrésalas desde Vehículos.` };
  if (libres.length === 0) return { opciones, aviso: `Las unidades disponibles de ${product.name} ya están en un carrito.` };
  return { opciones, aviso: `Ninguna unidad coincide con «${q.trim()}».` };
}

// --- 2B: garantía en préstamos y matrículas en custodia ---

/** Lo que se debe de una cuenta (venta o préstamo) y si va atrasada. */
export type Saldo = { pendiente: number; atrasado: boolean };

/** Motos del cliente que pueden respaldar un préstamo nuevo en esa sucursal:
 *  liberadas o vendidas. Que la venta esté saldada lo valida la base. */
export function vehiculosParaGarantia<V extends { customerId?: string | null; branchId: string; status: VehicleStatus }>(
  vehicles: V[], customerId: string, branchId: string,
): V[] {
  return vehicles.filter((v) => v.customerId === customerId && v.branchId === branchId
    && (v.status === 'liberado' || v.status === 'vendido'));
}

export const AVISO_DEUDA_MATRICULA =
  'La deuda de esta moto no está saldada. Solo un administrador puede entregar la matrícula, y con motivo.';

/** Si se puede entregar la matrícula y cómo. Espejo de motos_entregar_matricula. */
export function entregaDeMatricula(
  v: { registrationStatus: RegistrationStatus }, esAdmin: boolean,
): { puede: boolean; forzada: boolean; aviso: string | null } {
  if (v.registrationStatus === 'lista_para_entregar') return { puede: true, forzada: false, aviso: null };
  if (v.registrationStatus === 'en_custodia') {
    return esAdmin
      ? { puede: true, forzada: true, aviso: 'Tiene deuda pendiente: se entregará como forzada y hay que escribir el motivo.' }
      : { puede: false, forzada: false, aviso: AVISO_DEUDA_MATRICULA };
  }
  return { puede: false, forzada: false, aviso: 'Esa matrícula no está en custodia.' };
}

/** Días de calendario entre dos fechas (en la hora local). */
export function diasDesde(fecha: Date, hoy: Date): number {
  const dia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dia(hoy) - dia(fecha)) / 86_400_000);
}

type ConMatricula = {
  registrationStatus: RegistrationStatus;
  registrationSince?: Date | null;
  registrationDeliveredAt?: Date | null;
};

const tiempo = (d?: Date | null) => (d ? d.getTime() : 0);

/** Las tres pestañas de Matrículas. Listas: la que más lleva esperando primero.
 *  Entregadas: la más reciente primero. */
export function matriculasPorPestana<V extends ConMatricula>(vehicles: V[]): { enCustodia: V[]; listas: V[]; entregadas: V[] } {
  return {
    enCustodia: vehicles.filter((v) => v.registrationStatus === 'en_custodia')
      .sort((a, b) => tiempo(a.registrationSince) - tiempo(b.registrationSince)),
    listas: vehicles.filter((v) => v.registrationStatus === 'lista_para_entregar')
      .sort((a, b) => tiempo(a.registrationSince) - tiempo(b.registrationSince)),
    entregadas: vehicles.filter((v) => v.registrationStatus === 'entregada')
      .sort((a, b) => tiempo(b.registrationDeliveredAt) - tiempo(a.registrationDeliveredAt)),
  };
}

/** La cuenta de la moto: el préstamo si está en garantía o liberada, la venta si
 *  está vendida. Sin cuenta conocida, null. */
export function deudaDelVehiculo(
  v: { status: VehicleStatus; saleId?: string | null; loanId?: string | null },
  ventas: Map<string, Saldo>, prestamos: Map<string, Saldo>,
): Saldo | null {
  if ((v.status === 'en_garantia' || v.status === 'liberado') && v.loanId) return prestamos.get(v.loanId) ?? null;
  if (v.status === 'vendido' && v.saleId) return ventas.get(v.saleId) ?? null;
  return null;
}

/** Matrículas: en custodia y listas hoy, listas que llevan más de 30 días
 *  esperando, y entregadas dentro del período. */
export function reporteDeMatriculas(vehicles: ConMatricula[], desde: Date, hasta: Date, hoy: Date) {
  let enCustodia = 0;
  let listas = 0;
  let listasMasDe30 = 0;
  let entregadasEnPeriodo = 0;
  for (const v of vehicles) {
    if (v.registrationStatus === 'en_custodia') enCustodia += 1;
    if (v.registrationStatus === 'lista_para_entregar') {
      listas += 1;
      if (v.registrationSince && diasDesde(v.registrationSince, hoy) > 30) listasMasDe30 += 1;
    }
    const entregada = v.registrationDeliveredAt;
    if (v.registrationStatus === 'entregada' && entregada && entregada >= desde && entregada <= hasta) entregadasEnPeriodo += 1;
  }
  return { enCustodia, listas, listasMasDe30, entregadasEnPeriodo };
}
