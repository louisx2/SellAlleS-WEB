import type { PermissionAction, PermissionResource, RolePermissions } from '@/lib/types';
import type { ModuleKey } from '@/lib/modules';

export const PERMISSION_ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: 'view', label: 'Ver' },
  { key: 'create', label: 'Crear' },
  { key: 'edit', label: 'Editar' },
  { key: 'delete', label: 'Eliminar' },
];

// Un recurso por cada sección del menú gateada a admin (authed-layout.tsx).
// `actions` es opcional: un recurso que solo admite algunas acciones las lista
// aquí (la grilla de Roles solo pinta esas casillas); sin `actions` admite las
// cuatro. Para saber qué admite un recurso, usar actionsFor().
export const PERMISSION_RESOURCES: { key: PermissionResource; label: string; actions?: PermissionAction[] }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pos', label: 'Carrito (POS)' },
  { key: 'sales', label: 'Movimientos (Ventas)' },
  { key: 'quotes', label: 'Cotizaciones' },
  { key: 'services', label: 'Servicios' },
  { key: 'services-all', label: 'Servicios: ver todas las órdenes (sin esto, solo las suyas y las sin asignar)', actions: ['view'] },
  { key: 'credit', label: 'Cuentas por Cobrar' },
  { key: 'financing', label: 'Financiamientos' },
  { key: 'prestamos', label: 'Préstamos' },
  { key: 'caja', label: 'Caja' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'payables', label: 'Cuentas por Pagar (Suplidores)' },
  { key: 'reports', label: 'Reportes' },
  { key: 'products', label: 'Inventario' },
  { key: 'customers', label: 'Clientes' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'company-profile', label: 'Perfil de Empresa' },
  { key: 'users', label: 'Usuarios' },
  { key: 'branches', label: 'Sucursales' },
  { key: 'roles', label: 'Roles' },
  { key: 'suscripcion', label: 'Mi Suscripción' },
  { key: 'service-types', label: 'Configuración de Servicios' },
  { key: 'quick-sales', label: 'Ventas rápidas (fuera de inventario)', actions: ['create'] },
  { key: 'motos', label: 'Motopréstamos: vehículos' },
  { key: 'motos-config', label: 'Motopréstamos: configuración', actions: ['view', 'edit'] },
  { key: 'cobranza', label: 'Motopréstamos: cobrar en la calle (su ruta)', actions: ['view', 'create'] },
  { key: 'cobranza-all', label: 'Motopréstamos: ver y asignar la cartera de todos los cobradores', actions: ['view'] },
  { key: 'cobranza-cuadre', label: 'Motopréstamos: recibir la entrega de los cobradores', actions: ['view', 'create'] },
];

/** Acciones que admite un recurso: las suyas (`actions`) o las cuatro. */
export function actionsFor(resource: PermissionResource): PermissionAction[] {
  return (
    PERMISSION_RESOURCES.find((r) => r.key === resource)?.actions
    ?? PERMISSION_ACTIONS.map((a) => a.key)
  );
}

// Recurso → módulo que lo gobierna (mismo criterio que ROUTE_MODULE en
// src/lib/modules.ts). Los recursos que no aparecen aquí son núcleo y
// siempre están disponibles para asignar en un rol, sin importar módulos.
export const RESOURCE_MODULE: Partial<Record<PermissionResource, ModuleKey>> = {
  pos: 'pos',
  sales: 'sales',
  quotes: 'quotes',
  services: 'services',
  credit: 'credit',
  financing: 'financing',
  prestamos: 'prestamos',
  caja: 'caja',
  expenses: 'expenses',
  payables: 'payables',
  reports: 'reports',
  suppliers: 'suppliers',
  'service-types': 'services',
  'services-all': 'services',
  'quick-sales': 'quick-sales',
  motos: 'motoprestamos',
  'motos-config': 'motoprestamos',
  cobranza: 'motoprestamos',
  'cobranza-all': 'motoprestamos',
  'cobranza-cuadre': 'motoprestamos',
};

// Los reportes individuales (src/app/(app)/reports/*), controlables por
// separado dentro de un rol vía permissions.reports_visible.
/** Reportes cuya ruta ya no coincide con su slug de permiso (el slug se queda
 *  para no tocar los roles guardados). */
const REPORT_SLUG_POR_RUTA: Record<string, string> = { servicios: 'taller' };

/** Slug de permiso de un reporte a partir de su ruta (/reports/<ruta>). */
export function reportSlugForRoute(href: string): string {
  const ruta = href.split('/').pop() ?? '';
  return REPORT_SLUG_POR_RUTA[ruta] ?? ruta;
}

export const REPORT_ITEMS: { slug: string; label: string }[] = [
  { slug: 'sales-summary', label: 'Resumen de Ventas' },
  { slug: 'user-sales', label: 'Ventas por Usuario' },
  { slug: 'top-products', label: 'Productos Estrella (más vendidos)' },
  { slug: 'top-customers', label: 'Clientes Estrella' },
  { slug: 'comisiones', label: 'Comisiones por Vendedor' },
  { slug: 'taller', label: 'Servicios (personal, tiempos, materiales)' },
  { slug: 'vehiculos', label: 'Vehículos (cartera y ventas)' },
  { slug: 'date-range', label: 'Ingresos por Fechas' },
  { slug: 'receivables', label: 'Cuentas por Cobrar' },
  { slug: 'antiguedad', label: 'Antigüedad de Cartera' },
  { slug: 'cobranza', label: 'Cobranza por Cobrador' },
  { slug: 'cuadres', label: 'Cuadres de Cobradores' },
  { slug: 'recuperaciones', label: 'Recuperaciones de Motos' },
  { slug: 'inventory', label: 'Valorización de Inventario' },
  { slug: 'taxes', label: 'Impuestos' },
  { slug: 'ganancias', label: 'Reporte de Ganancias' },
  { slug: 'compras-606', label: 'Compras (Formato 606)' },
  { slug: 'ventas-607', label: 'Ventas (Formato 607)' },
  { slug: 'anulados-608', label: 'NCF Anulados (Formato 608)' },
  { slug: 'ventas-rapidas', label: 'Ventas Rápidas' },
];

// Red de seguridad: si por algún motivo no aparece la fila del rol de
// sistema (Administrador/Cajero) de la empresa del usuario, se usa esto en
// vez de dejarlo sin acceso. Debe reflejar exactamente lo que siembra
// seed_system_roles() en Supabase.
export const DEFAULT_ADMIN_PERMISSIONS: RolePermissions = Object.fromEntries(
  PERMISSION_RESOURCES.map((r) => [r.key, actionsFor(r.key)])
) as RolePermissions;

export const DEFAULT_CASHIER_PERMISSIONS: RolePermissions = {
  dashboard: ['view'],
  pos: ['view', 'create'],
  quotes: ['view', 'create'],
  // El mostrador ingresa, ve todos los casos, cobra y entrega. Un técnico se
  // arma como rol propio sin 'services-all' (ve los suyos y los sin asignar).
  services: ['view', 'create', 'edit'],
  'services-all': ['view'],
  caja: ['view', 'create'],
  'quick-sales': ['create'],
};

// Mínimo intocable de los roles de SISTEMA (Administrador/Cajero). El admin de
// la empresa puede recortarlos a su gusto, pero no dejar a su gente sin poder
// trabajar: sin Carrito ni Dashboard, un cajero entra y no puede hacer nada, y
// para arreglarlo haría falta un super admin. Se pintan marcados y desactivados
// en la grilla, y se vuelven a sumar al guardar por si llegan recortados.
export const SYSTEM_ROLE_MIN_PERMISSIONS: RolePermissions = {
  dashboard: ['view'],
  pos: ['view', 'create'],
};

export function isMinimumPermission(
  isSystemRole: boolean,
  resource: PermissionResource,
  action: PermissionAction
): boolean {
  return isSystemRole && !!SYSTEM_ROLE_MIN_PERMISSIONS[resource]?.includes(action);
}

/** Devuelve los permisos con el mínimo de los roles de sistema garantizado. */
export function withSystemRoleMinimums(permissions: RolePermissions): RolePermissions {
  return unionPermissions([{ permissions }, { permissions: SYSTEM_ROLE_MIN_PERMISSIONS }]);
}

// Secciones que gobierna el Administrador de la EMPRESA, no el rol de la
// sucursal. Son las de administrar el negocio; el resto (POS, ventas, caja,
// inventario...) son de operar y las decide el rol que se tenga en la sucursal
// activa. Esta línea es la que separa "gestionar" de "operar".
export const MANAGEMENT_RESOURCES: PermissionResource[] = [
  'company-profile', 'users', 'branches', 'roles', 'suscripcion',
];

// Permisos de gestión completos, para dárselos al Administrador de la empresa
// por encima de lo que pueda hacer en cada sucursal.
export const MANAGEMENT_PERMISSIONS: RolePermissions = Object.fromEntries(
  MANAGEMENT_RESOURCES.map((r) => [r, ['view', 'create', 'edit', 'delete']])
) as RolePermissions;

export function hasPermission(
  permissions: Partial<Record<PermissionResource, PermissionAction[]>> | undefined,
  resource: PermissionResource,
  action: PermissionAction
): boolean {
  return !!permissions?.[resource]?.includes(action);
}

// reports_visible ausente = todos los reportes visibles (compatibilidad con
// roles creados antes de que existiera este campo).
export function isReportVisible(permissions: RolePermissions | undefined, slug: string): boolean {
  if (!permissions?.reports_visible) return true;
  return permissions.reports_visible.includes(slug);
}

// Unión de los permisos de todos los roles de un usuario (su rol base de
// sistema + los roles personalizados adicionales vía profile_roles). Nunca
// resta: si CUALQUIER rol da acceso a algo, el usuario lo tiene.
export function unionPermissions(roles: { permissions?: RolePermissions }[]): RolePermissions {
  const result: RolePermissions = {};
  let reportsVisible: Set<string> | 'all' | undefined;
  for (const role of roles) {
    const perms = role.permissions ?? {};
    for (const key of Object.keys(perms) as PermissionResource[]) {
      if (key === ('reports_visible' as PermissionResource)) continue;
      const actions = perms[key] ?? [];
      const existing = new Set(result[key] ?? []);
      actions.forEach((a) => existing.add(a));
      result[key] = Array.from(existing);
    }
    if (perms.reports?.includes('view')) {
      if (!perms.reports_visible) {
        reportsVisible = 'all';
      } else if (reportsVisible !== 'all') {
        const set = reportsVisible instanceof Set ? reportsVisible : new Set<string>();
        perms.reports_visible.forEach((s) => set.add(s));
        reportsVisible = set;
      }
    }
  }
  if (reportsVisible instanceof Set) result.reports_visible = Array.from(reportsVisible);
  return result;
}
