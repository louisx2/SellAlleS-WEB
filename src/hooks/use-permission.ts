'use client';

import { useAuth } from '@/context/auth-provider';
import { hasPermission, unionPermissions } from '@/lib/permissions';
import type { PermissionAction, PermissionResource } from '@/lib/types';

// true para super admin siempre; para el resto, según la unión del rol base
// de sistema (Administrador/Cajero) más los roles personalizados adicionales
// (ej. "Gerente"), que solo suman visibilidad, nunca restan.
export function usePermission(resource: PermissionResource, action: PermissionAction = 'view'): boolean {
  const { appUser } = useAuth();
  if (!appUser) return false;
  if (appUser.isSuperAdmin) return true;
  const permissions = unionPermissions([
    { permissions: appUser.baseRolePermissions },
    ...(appUser.customRoles ?? []),
  ]);
  return hasPermission(permissions, resource, action);
}
