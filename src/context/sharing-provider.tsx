'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';

export type SharingScope = 'clientes' | 'credito' | 'financiamiento' | 'prestamos' | 'servicios' | 'categorias';

export const SHARING_SCOPES: SharingScope[] = ['clientes', 'credito', 'financiamiento', 'prestamos', 'servicios', 'categorias'];

interface SharingContextType {
  /**
   * Sucursales cuyos datos ve la sucursal activa en ese ámbito. Si la activa
   * está en el pool devuelve el pool entero; si no, solo ella misma. Vacío
   * mientras no haya sucursal activa: las consultas deben esperar.
   */
  branchesFor: (scope: SharingScope) => string[];
  /** El pool tal cual está guardado, para la pantalla de configuración. */
  pool: (scope: SharingScope) => string[];
  loading: boolean;
  reload: () => Promise<void>;
}

const SharingContext = createContext<SharingContextType | undefined>(undefined);

// Qué sucursales comparten datos entre sí, por ámbito (tabla branch_sharing).
// Un ámbito sin filas es el caso seguro: cada sucursal aislada con lo suyo.
export function SharingProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const activeBranchId = appUser?.activeBranchId;

  const [rows, setRows] = useState<{ scope: string; branch_id: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('branch_sharing')
      .select('scope, branch_id')
      .eq('company_id', activeCompanyId);
    if (!error && data) setRows(data as { scope: string; branch_id: string }[]);
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const pools = useMemo(() => {
    const map = new Map<SharingScope, string[]>();
    for (const scope of SHARING_SCOPES) map.set(scope, []);
    for (const r of rows) {
      const list = map.get(r.scope as SharingScope);
      if (list) list.push(r.branch_id);
    }
    return map;
  }, [rows]);

  const pool = useCallback((scope: SharingScope) => pools.get(scope) ?? [], [pools]);

  const branchesFor = useCallback((scope: SharingScope) => {
    if (!activeBranchId) return [];
    const list = pools.get(scope) ?? [];
    return list.includes(activeBranchId) ? list : [activeBranchId];
  }, [pools, activeBranchId]);

  return (
    <SharingContext.Provider value={{ branchesFor, pool, loading, reload: load }}>
      {children}
    </SharingContext.Provider>
  );
}

export const useSharing = (): SharingContextType => {
  const context = useContext(SharingContext);
  if (context === undefined) throw new Error('useSharing must be used within a SharingProvider');
  return context;
};
