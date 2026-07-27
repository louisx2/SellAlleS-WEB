'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  DEFAULT_SUPPORT_CONTACT,
  PLATFORM_SETTINGS_COLUMNS,
  mapSupportContact,
  setSupportContact,
  type SupportContact,
} from '@/lib/support-contact';

interface PlatformSettingsContextType {
  support: SupportContact;
  loading: boolean;
  reload: () => Promise<void>;
}

const PlatformSettingsContext = createContext<PlatformSettingsContextType | undefined>(undefined);

// Ajustes globales del SaaS (platform_settings): una sola fila, sin company_id,
// legible por cualquiera. A diferencia de ModulesProvider no depende del
// usuario ni de la empresa activa, así que carga una vez al montar.
// Si la consulta falla se conservan los valores por defecto: es preferible un
// botón de soporte apuntando al número viejo que un botón muerto.
export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const [support, setSupport] = useState<SupportContact>(DEFAULT_SUPPORT_CONTACT);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('platform_settings')
      .select(PLATFORM_SETTINGS_COLUMNS)
      .maybeSingle();
    if (!error && data) {
      const contact = mapSupportContact(data as never);
      setSupport(contact);
      // Espeja el valor en la caché de módulo para el código fuera de React.
      setSupportContact(contact);
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <PlatformSettingsContext.Provider value={{ support, loading, reload }}>
      {children}
    </PlatformSettingsContext.Provider>
  );
}

export const usePlatformSettings = (): PlatformSettingsContextType => {
  const context = useContext(PlatformSettingsContext);
  if (context === undefined) throw new Error('usePlatformSettings must be used within a PlatformSettingsProvider');
  return context;
};
