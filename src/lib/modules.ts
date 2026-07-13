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
  | 'lavanderia'
  | 'services'
  | 'prestamos'
  | 'loyalty'
  | 'customer-portal'
  | 'caja';

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
  { key: 'services',   label: 'Servicios/Reparaciones', description: 'Gestión de órdenes de servicio y uso de repuestos.',  defaultEnabled: true },
  { key: 'lavanderia', label: 'Lavandería',         description: 'Órdenes de servicio de lavandería.',                  defaultEnabled: false, comingSoon: true },
  { key: 'prestamos',  label: 'Préstamos',          description: 'Préstamos de dinero a clientes, con cuotas e interés, independientes de las ventas.', defaultEnabled: false },
  { key: 'loyalty',    label: 'Programa de Fidelidad', description: 'Cupones automáticos al alcanzar cierta cantidad de compras/servicios.', defaultEnabled: false },
  { key: 'customer-portal', label: 'Portal de Clientes ("Mi Estado de Cuenta")', description: 'Permite a los clientes de esta empresa consultar sus préstamos y compras a crédito en /mi-prestamo con cédula y PIN.', defaultEnabled: false },
  { key: 'caja',       label: 'Caja',               description: 'Control de efectivo por sucursal: apertura, cierre y movimientos. Al activarlo, no se puede cobrar en efectivo sin una caja abierta.', defaultEnabled: false },
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
  { prefix: '/services',  module: 'services' },
  { prefix: '/service-types', module: 'services' },
  { prefix: '/prestamos', module: 'prestamos' },
  { prefix: '/caja',      module: 'caja' },
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
