'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export type Vendedor = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  /** Solo llega para un admin; para el resto es null. */
  commissionRate: number | null;
};

// Miembros de la empresa activa (RPC vendedores_de_empresa). Va por RPC y no
// por `profiles`: la RLS de profiles solo deja ver a quien tiene esta empresa
// como activa, y un cajero no puede leer profile_companies de sus compañeros.
export function useVendedores(enabled: boolean) {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const { data, error: err } = await supabase.rpc('vendedores_de_empresa');
    if (err) {
      setError(err.message);
      setVendedores([]);
    } else {
      setError(null);
      setVendedores(
        ((data ?? []) as any[]).map((r) => ({
          id: r.profile_id,
          nombre: r.nombre ?? r.email ?? 'Sin nombre',
          email: r.email ?? '',
          rol: r.rol ?? '',
          activo: r.activo !== false,
          commissionRate: r.commission_rate != null ? Number(r.commission_rate) : null,
        })),
      );
    }
    setLoading(false);
  }, [enabled]);

  useEffect(() => { cargar(); }, [cargar]);

  return { vendedores, loading, error, recargar: cargar };
}
