'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { resolveEnabledModules, type ModuleKey } from '@/lib/modules';

interface ModulesContextType {
  isModuleEnabled: (key: ModuleKey) => boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

const ModulesContext = createContext<ModulesContextType | undefined>(undefined);

// Módulos habilitados para la empresa del usuario actual (RLS limita las
// filas a su propia empresa). Sin filas → defaults del catálogo.
export function ModulesProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<Set<ModuleKey>>(resolveEnabledModules([]));
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('company_modules').select('module_key, enabled');
    if (!error && data) setEnabled(resolveEnabledModules(data));
    setLoading(false);
  }, []);

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
