'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { MOTOS_SETTINGS_DEFAULT, motosSettingsToRow, rowToMotosSettings } from '@/lib/supabase/mappers';
import type { MotosSettings } from '@/lib/types';

/** Ajustes del módulo Motopréstamos de la empresa activa. Sin fila guardada,
 *  los valores por defecto (los mismos que usa la base). */
export function useMotosAjustes() {
  const { appUser } = useAuth();
  const companyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [ajustes, setAjustes] = useState<MotosSettings>({ ...MOTOS_SETTINGS_DEFAULT });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('motos_settings').select('*').eq('company_id', companyId).maybeSingle();
    setAjustes(rowToMotosSettings(data));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { reload(); }, [reload]);

  const guardar = async (patch: Partial<MotosSettings>): Promise<void> => {
    if (!companyId) throw new Error('No hay una empresa activa.');
    const { error } = await supabase
      .from('motos_settings')
      .upsert({ company_id: companyId, ...motosSettingsToRow(patch), updated_at: new Date().toISOString() }, { onConflict: 'company_id' });
    if (error) throw error;
    await reload();
  };

  return { ajustes, loading, reload, guardar };
}
