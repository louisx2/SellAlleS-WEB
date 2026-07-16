'use client';

import { useAuth } from '@/context/auth-provider';
import { hasPermission, unionPermissions } from '@/lib/permissions';
import type { PermissionAction, PermissionResource } from '@/lib/types';

// true para admins/super admin siempre; para el resto, solo si algún rol
// personalizado asignado (ej. "Gerente") otorga esa acción sobre ese recurso.
export function usePermission(resource: PermissionResource, action: PermissionAction = 'view'): boolean {
  const { appUser } = useAuth();
  if (!appUser) return false;
  if (appUser.isSuperAdmin || appUser.role === 'admin') return true;
  const permissions = unionPermissions(appUser.customRoles ?? []);
  return hasPermission(permissions, resource, action);
}
