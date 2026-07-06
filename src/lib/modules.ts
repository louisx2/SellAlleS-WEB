// Catálogo de módulos del SaaS.
// La tabla company_modules guarda SOLO las excepciones: si no hay fila para
// (empresa, módulo), aplica defaultEnabled. Así, agregar un módulo nuevo al
// catálogo no requiere backfill de todas las empresas.

export type ModuleKey =
  | 'pos'
  | 'sales'
  | 'quotes'
  | 'credit'
  | 'financing'
  | 'suppliers'
  | 'expenses'
  | 'reports'
  | 'lavanderia';

export interface AppModule {
  key: ModuleKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Aún sin páginas: se muestra en el panel pero no aparece en el menú. */
  comingSoon?: boolean;
}

export const APP_MODULES: AppModule[] = [
  { key: 'pos',        label: 'Punto de Venta',     description: 'Carritos, cobro y recibos.',                          defaultEnabled: true },
  { key: 'sales',      label: 'Historial de Ventas', description: 'Listado y detalle de ventas realizadas.',            defaultEnabled: true },
  { key: 'quotes',     label: 'Cotizaciones',       description: 'Crear cotizaciones y convertirlas en ventas.',        defaultEnabled: true },
  { key: 'credit',     label: 'Cuentas por Cobrar', description: 'Ventas a crédito y abonos de clientes.',              defaultEnabled: true },
  { key: 'financing',  label: 'Financiamiento',     description: 'Planes de cuotas con interés y mora.',                defaultEnabled: true },
  { key: 'suppliers',  label: 'Proveedores',        description: 'Directorio de suplidores.',                           defaultEnabled: true },
  { key: 'expenses',   label: 'Gastos',             description: 'Registro de gastos del negocio.',                     defaultEnabled: true },
  { key: 'reports',    label: 'Reportes',           description: 'Resúmenes de ventas, productos e impuestos.',         defaultEnabled: true },
  { key: 'lavanderia', label: 'Lavandería',         description: 'Órdenes de servicio de lavandería.',                  defaultEnabled: false, comingSoon: true },
];

/** Ruta → módulo que la gobierna. Las rutas que no aparecen aquí son núcleo
 *  (dashboard, productos, clientes, perfil, usuarios...) y no se apagan. */
const ROUTE_MODULE: Array<{ prefix: string; module: ModuleKey }> = [
  { prefix: '/pos',       module: 'pos' },
  { prefix: '/quotes',    module: 'quotes' },
  { prefix: '/sales',     module: 'sales' },
  { prefix: '/credit',    module: 'credit' },
  { prefix: '/financing', module: 'financing' },
  { prefix: '/suppliers', module: 'suppliers' },
  { prefix: '/expenses',  module: 'expenses' },
  { prefix: '/reports',   module: 'reports' },
];

export function moduleForRoute(pathname: string): ModuleKey | null {
  const hit = ROUTE_MODULE.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  return hit?.module ?? null;
}

/** Combina las filas de company_modules con los defaults del catálogo. */
export function resolveEnabledModules(rows: Array<{ module_key: string; enabled: boolean }>): Set<ModuleKey> {
  const overrides = new Map(rows.map((r) => [r.module_key, r.enabled]));
  const enabled = new Set<ModuleKey>();
  for (const mod of APP_MODULES) {
    if (overrides.get(mod.key) ?? mod.defaultEnabled) enabled.add(mod.key);
  }
  return enabled;
}
