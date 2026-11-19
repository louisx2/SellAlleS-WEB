'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { useModules } from '@/context/modules-provider';

/** Ubicación cuyas piezas no se ofrecen en el POS (Configuración del Taller →
 *  "Ocultar estas piezas en el POS"), o undefined si no hay que ocultar nada. */
export function usePiezasOcultasEnPos(): string | undefined {
  const { appUser } = useAuth();
  const { isModuleEnabled } = useModules();
  const branchId = appUser?.activeBranchId;
  const taller = isModuleEnabled('services');
  const [locationId, setLocationId] = useState<string | undefined>();

  useEffect(() => {
    if (!branchId || !taller) { setLocationId(undefined); return; }
    let vivo = true;
    supabase
      .from('taller_settings')
      .select('parts_location_id, hide_parts_in_pos')
      .eq('branch_id', branchId)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return;
        setLocationId(data?.hide_parts_in_pos && data.parts_location_id ? data.parts_location_id : undefined);
      });
    return () => { vivo = false; };
  }, [branchId, taller]);

  return locationId;
}
