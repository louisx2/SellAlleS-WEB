'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { NcfType } from '@/lib/types';

// Tipos de comprobante de venta. Las secuencias incluyen además nota_credito y
// nota_debito, que no se emiten desde el cobro.
const TIPOS_DE_VENTA: NcfType[] = ['consumer', 'fiscal', 'gubernamental', 'regimen_especial'];

/**
 * Tipos que la base podría emitir ahora mismo: espeja el filtro de assign_ncf
 * (activa, con números y sin vencer). Sin esto el cobro ofrece tipos que no
 * tienen secuencia y la venta muere al confirmar — justo lo que no puede pasar
 * en caja. RLS ya limita las filas a la empresa del usuario.
 */
export const useNcfAvailability = (enabled: boolean) => {
  // null mientras no se ha consultado; [] es "consultado y no hay ninguna".
  const [tiposDisponibles, setTiposDisponibles] = useState<NcfType[] | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setTiposDisponibles(null);
      return;
    }
    const hoy = new Date().toLocaleDateString('en-CA');
    const { data, error } = await supabase
      .from('ncf_sequences')
      .select('tipo, range_to, current_val, expires_at')
      .eq('active', true);

    if (error || !data) {
      setTiposDisponibles([]);
      return;
    }

    const usables = data
      .filter((s) => s.current_val <= s.range_to && (!s.expires_at || s.expires_at >= hoy))
      .map((s) => s.tipo as NcfType)
      .filter((t) => TIPOS_DE_VENTA.includes(t));

    setTiposDisponibles(Array.from(new Set(usables)));
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  return { tiposDisponibles, recargarNcf: load };
};
