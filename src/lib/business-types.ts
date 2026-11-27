import type { ModuleKey } from '@/lib/modules';

export type BusinessType = 'tienda' | 'ferreteria' | 'lavanderia' | 'reparaciones' | 'salon' | 'mascotas' | 'limpieza' | 'lubricentro' | 'prestamos' | 'motoprestamos' | 'otro';

export interface BusinessTypePreset {
  label: string;
  description: string;
  /** Verticales opcionales que este rubro enciende (el resto de OPTIONAL_VERTICALS
   *  se apaga explícitamente). Los módulos "núcleo" (pos, sales, credit...)
   *  no se tocan — quedan en su valor por defecto del catálogo para todos. */
  modules: ModuleKey[];
  productCategories?: string[];
  serviceTypes?: { name: string; basePrice?: number }[];
  /** Rubro del taller (src/lib/taller.ts → RUBROS): siembra tipos de equipo y chequeos. */
  tallerRubro?: string;
  /** Tipos de vehículo que siembra el módulo Motopréstamos. */
}

/** Módulos "verticales" que un preset de rubro puede activar/desactivar
 *  explícitamente al crear la empresa. */
export const OPTIONAL_VERTICALS: ModuleKey[] = ['services', 'lavanderia', 'prestamos', 'motoprestamos', 'caja', 'customer-portal'];

export const BUSINESS_TYPE_PRESETS: Record<BusinessType, BusinessTypePreset> = {
  tienda: {
    label: 'Tienda / Retail',
    description: 'Venta de productos: POS, inventario, crédito y financiamiento.',
    modules: [],
  },
  ferreteria: {
    label: 'Ferretería',
    description: 'Como Tienda, con categorías típicas de ferretería precargadas.',
    modules: [],
    productCategories: ['Herramientas', 'Plomería', 'Eléctrico', 'Pintura', 'Tornillería'],
  },
  lavanderia: {
    label: 'Lavandería',
    description: 'Órdenes de servicio de lavado y planchado.',
    modules: ['services', 'lavanderia'],
    serviceTypes: [
      { name: 'Lavado y secado' },
      { name: 'Lavado en seco' },
      { name: 'Planchado' },
    ],
  },
  reparaciones: {
    label: 'Reparación de teléfonos',
    description: 'Órdenes con chequeos de llegada, personal, piezas y seguimiento para el cliente.',
    modules: ['services'],
    // El catálogo (con precio) lo arma cada taller: cada servicio crea su artículo.
    tallerRubro: 'celulares',
  },
  salon: {
    label: 'Salón de belleza y uñas',
    description: 'Órdenes de servicio con el personal que atiende y los materiales del inventario.',
    modules: ['services'],
    tallerRubro: 'salon',
  },
  mascotas: {
    label: 'Veterinaria y peluquería de mascotas',
    description: 'Una ficha por mascota, con chequeos de llegada y seguimiento para el dueño.',
    modules: ['services'],
    tallerRubro: 'mascotas',
  },
  limpieza: {
    label: 'Limpieza',
    description: 'Órdenes de servicio a domicilio, con el personal asignado y cobro por el POS.',
    modules: ['services'],
    tallerRubro: 'limpieza',
  },
  lubricentro: {
    label: 'Lubricentro y cambio de aceite',
    description: 'Una ficha por vehículo, con kilometraje, chequeos y materiales del inventario.',
    modules: ['services'],
    tallerRubro: 'lubricentro',
  },
  prestamos: {
    label: 'Préstamos',
    description: 'Préstamos de dinero a clientes, con cuotas e interés.',
    modules: ['prestamos'],
  },
  motoprestamos: {
    label: 'Motopréstamos',
    description: 'Venta de motos a cuotas y préstamos con la moto en garantía.',
    modules: ['prestamos', 'motoprestamos', 'caja', 'customer-portal'],
  },
  otro: {
    label: 'Otro / no definido',
    description: 'Deja la configuración de módulos por defecto; se ajusta luego a mano.',
    modules: [],
  },
};
