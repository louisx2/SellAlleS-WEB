// Lógica pura del Taller: estados, textos y cálculos que comparten la lista, el
// caso, el ingreso y el recibo. Sin React ni Supabase, y solo `import type`.
import type { ChecklistAnswer, ChecklistItem, Customer, EquipmentType, Service, ServiceStatus } from './types';

export type StatusMeta = {
  /** Lo que ve el personal. */
  label: string;
  /** Lo que verá el cliente en el enlace de seguimiento (entrega 2). */
  customerText: string;
  /** Clases del distintivo: fondo y texto con contraste en claro y oscuro. */
  badge: string;
  /** Sigue en el taller (no entregado ni cancelado). */
  open: boolean;
};

export const SERVICE_STATUS: Record<ServiceStatus, StatusMeta> = {
  received:          { label: 'Recibido',             customerText: 'Recibimos tu equipo',              badge: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',       open: true },
  diagnosing:        { label: 'En diagnóstico',       customerText: 'Lo estamos revisando',             badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100',             open: true },
  awaiting_approval: { label: 'Esperando aprobación', customerText: 'Te enviamos el presupuesto',       badge: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',     open: true },
  awaiting_parts:    { label: 'Esperando pieza',      customerText: 'Pedimos la pieza para tu equipo',  badge: 'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100', open: true },
  in_repair:         { label: 'En reparación',        customerText: 'Lo estamos reparando',             badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100', open: true },
  ready:             { label: 'Listo para retirar',   customerText: '¡Ya está listo! Pasa a buscarlo',  badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100', open: true },
  not_repaired:      { label: 'No se pudo reparar',   customerText: 'No se pudo reparar; pasa a retirarlo', badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-100',   open: true },
  delivered:         { label: 'Entregado',            customerText: 'Entregado',                        badge: 'bg-muted text-muted-foreground',                                           open: false },
  cancelled:         { label: 'Cancelado',            customerText: 'Cancelado',                        badge: 'bg-muted text-muted-foreground line-through',                              open: false },
};

/** Orden en que se muestran (y se ofrecen al cambiar de estado). */
export const STATUS_ORDER: ServiceStatus[] = [
  'received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair',
  'ready', 'not_repaired', 'delivered', 'cancelled',
];

/** Camino de una orden: si se queda en el local y si es una reparación. De eso
 *  dependen los estados que se ofrecen y las palabras que se usan. */
export type StatusCtx = { staysInShop: boolean; isRepair: boolean };

export const statusCtx = (s: Pick<Service, 'staysInShop' | 'isRepair'>): StatusCtx =>
  ({ staysInShop: s.staysInShop, isRepair: s.isRepair });

/** Texto de un estado para el personal, según el camino de la orden. */
export function statusLabel(st: ServiceStatus, ctx: StatusCtx): string {
  switch (st) {
    case 'received': return ctx.staysInShop ? 'Recibido' : 'Llegó';
    case 'in_repair': return ctx.isRepair ? 'En reparación' : 'En proceso';
    case 'delivered': return ctx.staysInShop ? 'Entregado' : 'Terminado';
    case 'cancelled': return 'Cancelada';
    default: return SERVICE_STATUS[st].label;
  }
}

/** Texto de un estado para el cliente, según el camino de la orden. */
export function customerText(st: ServiceStatus, ctx: StatusCtx): string {
  switch (st) {
    case 'received': return ctx.staysInShop ? 'Ya lo recibimos' : 'Ya te anotamos';
    case 'in_repair': return ctx.isRepair ? 'Lo estamos reparando' : 'Lo estamos atendiendo';
    case 'delivered': return ctx.staysInShop ? 'Entregado' : '¡Gracias por visitarnos!';
    case 'cancelled': return 'Cancelada';
    default: return SERVICE_STATUS[st].customerText;
  }
}

/** Estados a los que se puede pasar a mano desde uno abierto. Entregar/terminar
 *  tiene su propio botón y cancelar su propia confirmación. */
export function manualStatuses(ctx: StatusCtx): ServiceStatus[] {
  if (ctx.isRepair) {
    return ctx.staysInShop
      ? ['received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair', 'ready', 'not_repaired']
      : ['received', 'diagnosing', 'awaiting_approval', 'awaiting_parts', 'in_repair', 'not_repaired'];
  }
  return ctx.staysInShop ? ['received', 'in_repair', 'ready'] : ['received', 'in_repair'];
}

export const isOpen = (s: ServiceStatus) => SERVICE_STATUS[s]?.open ?? false;
export const isReadyToDeliver = (s: ServiceStatus) => s === 'ready' || s === 'not_repaired';

/** ¿Se puede cerrar (entregar o terminar) desde este estado? */
export function canClose(st: ServiceStatus, ctx: StatusCtx): boolean {
  if (st === 'delivered' || st === 'cancelled') return false;
  return ctx.staysInShop ? isReadyToDeliver(st) : true;
}

export const closeLabel = (ctx: StatusCtx): 'Entregar' | 'Terminar' => (ctx.staysInShop ? 'Entregar' : 'Terminar');

/** Si la orden se queda en el local: nunca cuando se atiende donde el cliente. */
export function defaultStaysInShop(type: Pick<EquipmentType, 'staysInShop'> | undefined, atCustomer: boolean): boolean {
  return !atCustomer && !!type?.staysInShop;
}

export type OrdenNuevaInput = {
  /** «Atender ahora»: entra directo en proceso. */
  ahora: boolean;
  /** Tipo de la ficha elegida; sin ficha, undefined. */
  tipo?: Pick<EquipmentType, 'staysInShop' | 'isRepair'>;
  /** «El cliente espera»: no se queda aunque el tipo lo diga. */
  clienteEspera: boolean;
  atCustomer: boolean;
  /** Dirección escrita en la pantalla (vacía = la del cliente). */
  direccion?: string;
  cliente?: Pick<Customer, 'address' | 'collectionAddress'>;
  lineas: { staffIds: string[] }[];
  /** Persona elegida en «Lo atiende». */
  responsable?: string;
};

export type OrdenNueva = {
  status: 'received' | 'in_repair';
  stays_in_shop: boolean;
  is_repair: boolean;
  at_customer: boolean;
  service_address: string | null;
  staff_id: string | null;
};

/** Camino, responsable y dirección de una orden nueva (las columnas de `services`
 *  que salen de lo elegido). Nunca entra «Lista». */
export function ordenNueva(i: OrdenNuevaInput): OrdenNueva {
  const limpio = (s?: string) => s?.trim() || null;
  return {
    status: i.ahora ? 'in_repair' : 'received',
    stays_in_shop: !i.clienteEspera && defaultStaysInShop(i.tipo, i.atCustomer),
    is_repair: !!i.tipo?.isRepair,
    at_customer: i.atCustomer,
    service_address: i.atCustomer
      ? limpio(i.direccion) ?? limpio(i.cliente?.collectionAddress) ?? limpio(i.cliente?.address)
      : null,
    staff_id: i.responsable || i.lineas[0]?.staffIds[0] || null,
  };
}

/** Campos de marca / modelo / serie de la ficha, en ese orden, sin los que no se piden. */
export function fichaFields(
  t: Pick<EquipmentType, 'brandLabel' | 'modelLabel' | 'serialLabel'>,
): { key: 'brand' | 'model' | 'serial'; label: string }[] {
  const out: { key: 'brand' | 'model' | 'serial'; label: string }[] = [];
  if (t.brandLabel) out.push({ key: 'brand', label: t.brandLabel });
  if (t.modelLabel) out.push({ key: 'model', label: t.modelLabel });
  if (t.serialLabel) out.push({ key: 'serial', label: t.serialLabel });
  return out;
}

/** Campos de la ficha de una orden: los de su tipo o, si el tipo ya no está,
 *  los tres de siempre (para no esconder lo que se anotó). */
export function camposDeFicha(
  t?: Pick<EquipmentType, 'brandLabel' | 'modelLabel' | 'serialLabel'>,
): { key: 'brand' | 'model' | 'serial'; label: string }[] {
  return t ? fichaFields(t) : [{ key: 'brand', label: 'Marca' }, { key: 'model', label: 'Modelo' }, { key: 'serial', label: 'Serie' }];
}

/** Valor de un campo de la ficha en la copia que guarda la orden. */
export function valorDeFicha(s: Pick<Service, 'equipmentBrand' | 'equipmentModel' | 'equipmentSerial'>,
  key: 'brand' | 'model' | 'serial'): string | undefined {
  return key === 'brand' ? s.equipmentBrand : key === 'model' ? s.equipmentModel : s.equipmentSerial;
}

/** "#0142": con ceros a la izquierda hasta 4 cifras, para que se lea igual en
 *  la lista, el recibo y el POS. */
export function caseNumber(n: number): string {
  return `#${String(n).padStart(4, '0')}`;
}

/** Equipo en una línea: "Apple iPhone 13 Pro Max". */
export function equipmentLabel(s: Pick<Service, 'equipmentBrand' | 'equipmentModel'>): string {
  return [s.equipmentBrand, s.equipmentModel].map((x) => x?.trim()).filter(Boolean).join(' ');
}

/** Días completos desde que entró (o hasta que se entregó). */
export function daysInShop(s: Pick<Service, 'createdAt' | 'deliveredAt'>, now: Date = new Date()): number {
  const end = s.deliveredAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - s.createdAt.getTime()) / 86_400_000));
}

/** Prometido para una fecha que ya pasó y sigue abierto. */
export function isLate(s: Pick<Service, 'promisedAt' | 'status'>, now: Date = new Date()): boolean {
  return !!s.promisedAt && isOpen(s.status) && !isReadyToDeliver(s.status) && s.promisedAt.getTime() < now.getTime();
}

/** Chequeos que tocan a un tipo de equipo: los suyos y los de "todos", activos y en orden. */
export function checklistFor(items: ChecklistItem[], equipmentTypeId?: string): ChecklistItem[] {
  return items
    .filter((i) => i.isActive && (!i.equipmentTypeId || i.equipmentTypeId === equipmentTypeId))
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

/** Primer chequeo obligatorio sin contestar, o null. En modo rápido mandan los
 *  marcados "obligatorio en rápida". */
export function missingRequired(
  items: ChecklistItem[],
  answers: Record<string, ChecklistAnswer | undefined>,
  quick: boolean,
): ChecklistItem | null {
  for (const item of items) {
    const required = quick ? item.requiredQuick : item.required;
    if (required && !answers[item.id]) return item;
  }
  return null;
}

export const ANSWER_LABEL: Record<ChecklistAnswer['answer'], string> = {
  si: 'Sí',
  no: 'No',
  np: 'No se pudo probar',
};

/** Teléfono en el formato de WhatsApp: los 10 dígitos de RD llevan el 1 delante. */
export function whatsappPhone(phone?: string | null): string {
  let p = (phone ?? '').replace(/\D/g, '');
  if (p.length === 10 && /^(809|829|849)/.test(p)) p = '1' + p;
  return p;
}

/** Dominio de los enlaces públicos: el mismo de los comprobantes. */
export const ENLACE_BASE = 'https://sellalles.com';

/** Enlace público de seguimiento, con el mismo formato que el de las facturas:
 *  sellalles.com/<empresa>/c/<código>. El nombre de la empresa es decorativo (le
 *  dice al cliente de quién es antes de abrirlo); lo que protege el caso es el
 *  código. La función `c` lo reconoce (10 caracteres) y redirige a la página
 *  /seguimiento de la app. */
export function trackingUrl(code: string, empresaSlug: string): string {
  return `${ENLACE_BASE}/${empresaSlug || 'taller'}/c/${encodeURIComponent(code)}`;
}

/** Mensaje para avisarle al cliente cómo va su orden. A domicilio lleva la
 *  dirección del servicio. */
export function mensajeDeEstado(s: Pick<Service, 'number' | 'status' | 'equipmentBrand' | 'equipmentModel' | 'total' | 'paymentStatus' | 'staysInShop' | 'isRepair' | 'atCustomer' | 'serviceAddress'>,
  cliente: string | undefined, negocio: string, enlace?: string): string {
  const ficha = equipmentLabel(s);
  const sobre = ficha ? `${ficha} (orden ${caseNumber(s.number)})` : `tu orden ${caseNumber(s.number)}`;
  const saludo = cliente ? `Hola ${cliente.split(' ')[0]}` : 'Hola';
  let texto = `${saludo}, te escribimos de ${negocio} sobre ${sobre}: ${customerText(s.status, statusCtx(s))}.`;
  const direccion = s.atCustomer ? s.serviceAddress?.trim() : '';
  if (direccion) texto += ` Dirección del servicio: ${direccion}.`;
  if (isReadyToDeliver(s.status) && s.total > 0 && s.paymentStatus !== 'paid') {
    texto += ` El total es RD$${s.total.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  }
  if (enlace) texto += `\n\nPuedes ver cómo va en cualquier momento aquí: ${enlace}`;
  return texto;
}

/** ¿Sigue cubierto por la garantía? (fecha local AAAA-MM-DD contra hoy). */
export function warrantyActive(until?: string, today: Date = new Date()): boolean {
  if (!until) return false;
  const hoy = today.toLocaleDateString('en-CA'); // AAAA-MM-DD en la zona del navegador
  return until >= hoy;
}

export const fmtDate = (iso?: string) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Clave de un campo extra a partir de su nombre ("Kilometraje" → "kilometraje"). */
export function fieldKey(label: string): string {
  const base = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'campo';
}

export type EquipmentTemplate = {
  name: string;
  brandLabel: string | null;
  modelLabel: string | null;
  serialLabel: string | null;
  asksPassword: boolean;
  staysInShop: boolean;
  isRepair: boolean;
  extraFields?: { key: string; label: string; type: 'text' | 'number' }[];
  /** Los dos primeros quedan obligatorios (también en rápida). */
  checklist: string[];
};

/** Plantillas por rubro: cargan de una vez los tipos de equipo y sus chequeos.
 *  Se contestan Sí / No ("Rayones: Sí" = tiene rayones). Todo se puede editar. */
const REP = { brandLabel: 'Marca', modelLabel: 'Modelo', staysInShop: true, isRepair: true } as const;

export const RUBROS: { key: string; label: string; equipos: EquipmentTemplate[]; aDomicilio?: boolean }[] = [
  {
    key: 'celulares',
    label: 'Celulares y tablets',
    equipos: [
      { ...REP, name: 'Teléfono', serialLabel: 'IMEI', asksPassword: true,
        checklist: ['Prende', 'Rayones en pantalla', 'Suena', 'Carga', 'Cámaras funcionan', 'Touch responde', 'Golpes en la tapa', 'Faltan botones', 'Face ID / huella'] },
      { ...REP, name: 'Tablet', serialLabel: 'Serie', asksPassword: true,
        checklist: ['Prende', 'Rayones en pantalla', 'Carga', 'Touch responde', 'Golpes', 'Faltan botones'] },
    ],
  },
  {
    key: 'computadoras',
    label: 'Computadoras',
    equipos: [
      { ...REP, name: 'Laptop', serialLabel: 'Serie', asksPassword: true,
        checklist: ['Prende', 'Rayones en pantalla', 'Da imagen', 'Faltan teclas', 'Bisagras bien', 'Trae cargador', 'Batería carga', 'Golpes'] },
      { ...REP, name: 'PC de escritorio', serialLabel: 'Serie', asksPassword: true,
        checklist: ['Prende', 'Da imagen', 'Trae cable de poder', 'Trae teclado/mouse', 'Golpes'] },
    ],
  },
  {
    key: 'electronica',
    label: 'Electrónica y electrodomésticos',
    equipos: [
      { ...REP, name: 'Televisor', serialLabel: 'Serie', asksPassword: false,
        checklist: ['Prende', 'Pantalla rota', 'Da imagen', 'Tiene sonido', 'Trae control', 'Trae base'] },
      { ...REP, name: 'Electrodoméstico', serialLabel: 'Serie', asksPassword: false,
        checklist: ['Prende', 'Golpes', 'Trae accesorios', 'Hace ruido raro', 'Bota agua'] },
    ],
  },
  {
    key: 'vehiculos',
    label: 'Mecánica (vehículos)',
    equipos: [
      { ...REP, name: 'Vehículo', serialLabel: 'Placa', asksPassword: false,
        extraFields: [
          { key: 'kilometraje', label: 'Kilometraje', type: 'number' },
          { key: 'ano', label: 'Año', type: 'number' },
          { key: 'color', label: 'Color', type: 'text' },
          { key: 'combustible', label: 'Nivel de combustible', type: 'text' },
        ],
        checklist: ['Enciende', 'Rayones', 'Golpes', 'Luces funcionan', 'Gomas en buen estado', 'Retrovisores completos', 'Radio funciona', 'Trae gato y goma de repuesto', 'Objetos de valor dentro'] },
      { ...REP, name: 'Motor', serialLabel: 'Placa', asksPassword: false,
        extraFields: [{ key: 'kilometraje', label: 'Kilometraje', type: 'number' }],
        checklist: ['Enciende', 'Rayones', 'Golpes', 'Luces funcionan', 'Gomas en buen estado', 'Trae casco'] },
    ],
  },
  {
    key: 'lubricentro',
    label: 'Lubricentro / motos',
    equipos: ['Moto', 'Vehículo'].map((name) => ({
      name, brandLabel: 'Marca', modelLabel: 'Modelo', serialLabel: 'Placa', asksPassword: false,
      staysInShop: true, isRepair: false,
      extraFields: [
        { key: 'kilometraje', label: 'Kilometraje', type: 'number' as const },
        { key: 'ano', label: 'Año', type: 'number' as const },
      ],
      checklist: ['Enciende', 'Rayones', 'Golpes', 'Luces funcionan', 'Nivel de aceite'],
    })),
  },
  {
    key: 'mascotas',
    label: 'Peluquería de mascotas',
    equipos: ['Perro', 'Gato'].map((name) => ({
      name, brandLabel: 'Nombre', modelLabel: 'Raza', serialLabel: null, asksPassword: false,
      staysInShop: true, isRepair: false,
      extraFields: [
        { key: 'tamano', label: 'Tamaño', type: 'text' as const },
        { key: 'peso', label: 'Peso', type: 'number' as const },
      ],
      checklist: ['Pulgas', 'Garrapatas', 'Heridas', 'Nudos', 'Agresivo'],
    })),
  },
  { key: 'salon', label: 'Salón de belleza y uñas', equipos: [] },
  { key: 'limpieza', label: 'Limpieza', equipos: [], aDomicilio: true },
];

/** Tipos de ficha de un rubro que todavía no existen (compara sin mayúsculas ni espacios). */
export function tiposQueFaltan(key: string, existentes: string[]): EquipmentTemplate[] {
  const rubro = RUBROS.find((r) => r.key === key);
  if (!rubro) return [];
  const tengo = new Set(existentes.map((n) => n.trim().toLowerCase()));
  return rubro.equipos.filter((e) => !tengo.has(e.name.trim().toLowerCase()));
}

export type FilaAjustesADomicilio = {
  company_id: string;
  branch_id: string;
  default_at_customer: true;
  updated_at: string;
};

/** Filas de `taller_settings` para que las órdenes nuevas salgan a domicilio, al
 *  cargar un rubro a domicilio: solo las sucursales de ESA empresa, cada una con su
 *  company_id. Sin empresa, ninguna (quien ve sucursales de varias empresas —un super
 *  admin, alguien de dos empresas— no tiene que tocar las de otra). */
export function filasDeAjustes(
  companyId: string | null | undefined,
  branches: { id: string; company_id: string }[],
  ahora: Date = new Date(),
): FilaAjustesADomicilio[] {
  if (!companyId) return [];
  return branches
    .filter((b) => b.company_id === companyId)
    .map((b) => ({ company_id: companyId, branch_id: b.id, default_at_customer: true, updated_at: ahora.toISOString() }));
}
