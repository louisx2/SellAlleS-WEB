import type { ModuleKey } from '@/lib/modules';

export type BusinessType = 'tienda' | 'ferreteria' | 'lavanderia' | 'reparaciones' | 'prestamos' | 'otro';

export interface BusinessTypePreset {
  label: string;
  description: string;
  /** Verticales opcionales que este rubro enciende (el resto de OPTIONAL_VERTICALS
   *  se apaga explícitamente). Los módulos "núcleo" (pos, sales, credit...)
   *  no se tocan — quedan en su valor por defecto del catálogo para todos. */
  modules: ModuleKey[];
  productCategories?: string[];
  serviceTypes?: { name: string; basePrice?: number }[];
}

/** Módulos "verticales" que un preset de rubro puede activar/desactivar
 *  explícitamente al crear la empresa. */
export const OPTIONAL_VERTICALS: ModuleKey[] = ['services', 'lavanderia', 'prestamos'];

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
    description: 'Órdenes de servicio técnico con repuestos.',
    modules: ['services'],
    serviceTypes: [
      { name: 'Cambio de pantalla' },
      { name: 'Cambio de batería' },
      { name: 'Reparación de puerto de carga' },
    ],
  },
  prestamos: {
    label: 'Préstamos',
    description: 'Préstamos de dinero a clientes, con cuotas e interés.',
    modules: ['prestamos'],
  },
  otro: {
    label: 'Otro / no definido',
    description: 'Deja la configuración de módulos por defecto; se ajusta luego a mano.',
    modules: [],
  },
};
