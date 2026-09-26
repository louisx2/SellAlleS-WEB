'use client';

import { useAuth } from '@/context/auth-provider';
import { usePermission } from '@/hooks/use-permission';

// Quién puede transferir desde la sucursal activa. Mismo criterio que
// puede_editar_inventario() en la base: el admin de la empresa, o quien tiene
// Inventario → Editar en el rol de esta sucursal. Antes era solo el admin, y
// los gerentes, que sí podían crear artículos, no tenían forma de mandar
// mercancía de su inventario al de otra sucursal.
export function useCanTransfer(): boolean {
  const { appUser } = useAuth();
  const canEditInventory = usePermission('products', 'edit');
  return appUser?.role === 'admin' || canEditInventory;
}
