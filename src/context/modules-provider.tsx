'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { resolveEnabledModules, type ModuleKey } from '@/lib/modules';
import { useAuth } from '@/context/auth-provider';

interface ModulesContextType {
  isModuleEnabled: (key: ModuleKey) => boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

const ModulesContext = createContext<ModulesContextType | undefined>(undefined);

// Módulos habilitados para la empresa ACTIVA. Se filtra explícitamente por
// company_id (no basta con RLS): el super admin tiene una política que le
// da acceso a los company_modules de TODAS las empresas a la vez, y sin este
// filtro el mapa module_key -> enabled se mezcla entre empresas — un módulo
// apagado en OTRA empresa podía ocultar un reporte en la que se está
// impersonando. Sin filas → defaults del catálogo.
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [enabled, setEnabled] = useState<Set<ModuleKey>>(resolveEnabledModules([]));
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!activeCompanyId) { setEnabled(resolveEnabledModules([])); setLoading(false); return; }
    const { data, error } = await supabase
      .from('company_modules')
      .select('module_key, enabled')
      .eq('company_id', activeCompanyId);
    if (!error && data) setEnabled(resolveEnabledModules(data));
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { reload(); }, [reload]);

  const isModuleEnabled = useCallback((key: ModuleKey) => enabled.has(key), [enabled]);

  return (
    <ModulesContext.Provider value={{ isModuleEnabled, loading, reload }}>
      {children}
    </ModulesContext.Provider>
  );
}

export const useModules = (): ModulesContextType => {
  const context = useContext(ModulesContext);
  if (context === undefined) throw new Error('useModules must be used within a ModulesProvider');
  return context;
};
