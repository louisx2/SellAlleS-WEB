'use client';

import { useModules } from '@/context/modules-provider';
import { usePermission } from '@/hooks/use-permission';

// Quién puede vender artículos fuera de inventario en la sucursal activa: la
// empresa tiene el módulo encendido y el rol efectivo trae Ventas rápidas →
// Crear. Es el mismo doble candado que aplica `create_sale_with_items`, así el
// POS no ofrece (ni carga desde una cotización) lo que la base va a rechazar.
export function useCanQuickSell(): boolean {
  const { isModuleEnabled } = useModules();
  const canCreate = usePermission('quick-sales', 'create');
  return isModuleEnabled('quick-sales') && canCreate;
}
