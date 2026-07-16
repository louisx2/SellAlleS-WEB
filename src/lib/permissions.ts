import type { PermissionAction, PermissionResource, RolePermissions } from '@/lib/types';
import type { ModuleKey } from '@/lib/modules';

export const PERMISSION_ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: 'view', label: 'Ver' },
  { key: 'create', label: 'Crear' },
  { key: 'edit', label: 'Editar' },
  { key: 'delete', label: 'Eliminar' },
];

// Un recurso por cada sección del menú gateada a admin (authed-layout.tsx).
export const PERMISSION_RESOURCES: { key: PermissionResource; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pos', label: 'Carrito (POS)' },
  { key: 'sales', label: 'Movimientos (Ventas)' },
  { key: 'quotes', label: 'Cotizaciones' },
  { key: 'services', label: 'Servicios' },
  { key: 'credit', label: 'Cuentas por Cobrar' },
  { key: 'financing', label: 'Financiamientos' },
  { key: 'prestamos', label: 'Préstamos' },
  { key: 'caja', label: 'Caja' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'reports', label: 'Reportes' },
  { key: 'products', label: 'Inventario' },
  { key: 'customers', label: 'Clientes' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'company-profile', label: 'Perfil de Empresa' },
  { key: 'users', label: 'Usuarios' },
  { key: 'branches', label: 'Sucursales' },
  { key: 'roles', label: 'Roles' },
  { key: 'suscripcion', label: 'Mi Suscripción' },
  { key: 'service-types', label: 'Tipos de Servicio' },
];

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
  reports: 'reports',
  suppliers: 'suppliers',
  'service-types': 'services',
};

// Los 7 reportes individuales (src/app/(app)/reports/*), controlables por
// separado dentro de un rol vía permissions.reports_visible.
export const REPORT_ITEMS: { slug: string; label: string }[] = [
  { slug: 'sales-summary', label: 'Resumen de Ventas' },
  { slug: 'user-sales', label: 'Ventas por Usuario' },
  { slug: 'top-products', label: 'Productos Más Vendidos' },
  { slug: 'date-range', label: 'Ingresos por Fechas' },
  { slug: 'receivables', label: 'Cuentas por Cobrar' },
  { slug: 'inventory', label: 'Valorización de Inventario' },
  { slug: 'taxes', label: 'Impuestos' },
];

// Red de seguridad: si por algún motivo no aparece la fila del rol de
// sistema (Administrador/Cajero) de la empresa del usuario, se usa esto en
// vez de dejarlo sin acceso. Debe reflejar exactamente lo que siembra
// seed_system_roles() en Supabase.
export const DEFAULT_ADMIN_PERMISSIONS: RolePermissions = Object.fromEntries(
  PERMISSION_RESOURCES.map((r) => [r.key, ['view', 'create', 'edit', 'delete']])
) as RolePermissions;

export const DEFAULT_CASHIER_PERMISSIONS: RolePermissions = {
  dashboard: ['view'],
  pos: ['view', 'create'],
  quotes: ['view', 'create'],
  services: ['view', 'create'],
  caja: ['view', 'create'],
};

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
