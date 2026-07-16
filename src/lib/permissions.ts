import type { PermissionAction, PermissionResource, Role } from '@/lib/types';

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

export function hasPermission(
  permissions: Partial<Record<PermissionResource, PermissionAction[]>> | undefined,
  resource: PermissionResource,
  action: PermissionAction
): boolean {
  return !!permissions?.[resource]?.includes(action);
}

// Unión de los permisos de todos los roles personalizados de un usuario
// (un usuario puede tener más de un rol adicional vía profile_roles).
export function unionPermissions(roles: Role[]): Partial<Record<PermissionResource, PermissionAction[]>> {
  const result: Partial<Record<PermissionResource, PermissionAction[]>> = {};
  for (const role of roles) {
    const perms = role.permissions ?? {};
    for (const key of Object.keys(perms) as PermissionResource[]) {
      const actions = perms[key] ?? [];
      const existing = new Set(result[key] ?? []);
      actions.forEach((a) => existing.add(a));
      result[key] = Array.from(existing);
    }
  }
  return result;
}
