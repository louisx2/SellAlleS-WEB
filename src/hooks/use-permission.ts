'use client';

import { useAuth } from '@/context/auth-provider';
import { hasPermission } from '@/lib/permissions';
import type { PermissionAction, PermissionResource } from '@/lib/types';

// true para super admin siempre. Para el resto manda `baseRolePermissions`, que
// son los permisos EFECTIVOS en la sucursal activa: los del rol que la persona
// tiene en esa sucursal, más las secciones de gestión si es Administrador de la
// empresa (ver auth-provider).
//
// Antes esto unía además los roles de profile_roles, que eran de empresa y por
// tanto daban lo mismo en todas las sucursales — justo lo que se corrigió al
// pasar el rol a la asignación (profile_branches.role_id).
export function usePermission(resource: PermissionResource, action: PermissionAction = 'view'): boolean {
  const { appUser } = useAuth();
  if (!appUser) return false;
  if (appUser.isSuperAdmin) return true;
  return hasPermission(appUser.baseRolePermissions, resource, action);
}
