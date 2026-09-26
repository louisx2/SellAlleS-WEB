'use client';

import { useAuth } from '@/context/auth-provider';
import { usePermission } from '@/hooks/use-permission';

// Quién puede transferir desde la sucursal activa. Mismo criterio que
// puede_editar_inventario() en la base: el admin de la empresa, o quien tiene
// Inventario → Editar en el rol de esta sucursal. Antes era solo el admin, y
// los gerentes, que sí podían crear artículos, cargaban a mano en la otra
// sucursal lo que se mandaba, sin descontarlo de la primera.
export function useCanTransfer(): boolean {
  const { appUser } = useAuth();
  const canEditInventory = usePermission('products', 'edit');
  return appUser?.role === 'admin' || canEditInventory;
}
