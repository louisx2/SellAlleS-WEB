'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { guarantorToRow, referenceToRow, rowToGuarantor, rowToReference } from '@/lib/supabase/mappers';
import type { CustomerGuarantor, CustomerReference } from '@/lib/types';

type NuevoGarante = Omit<CustomerGuarantor, 'id' | 'customerId'>;
type NuevaReferencia = Omit<CustomerReference, 'id' | 'customerId'>;

/** Garantes y referencias de un cliente (Motopréstamos). Van por cliente, no por
 *  operación. La RLS deja ver y escribir lo del cliente que el usuario ve. */
export function useGarantes(customerId?: string) {
  const [garantes, setGarantes] = useState<CustomerGuarantor[]>([]);
  const [referencias, setReferencias] = useState<CustomerReference[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!customerId) { setGarantes([]); setReferencias([]); setLoading(false); return; }
    setLoading(true);
    const [g, r] = await Promise.all([
      supabase.from('customer_guarantors').select('*').eq('customer_id', customerId).order('created_at'),
      supabase.from('customer_references').select('*').eq('customer_id', customerId).order('created_at'),
    ]);
    setGarantes((g.data ?? []).map(rowToGuarantor));
    setReferencias((r.data ?? []).map(rowToReference));
    setLoading(false);
  }, [customerId]);

  useEffect(() => { reload(); }, [reload]);

  const ejecutar = async (op: PromiseLike<{ error: unknown }>) => {
    const { error } = await op;
    if (error) throw error;
    await reload();
  };

  return {
    garantes, referencias, loading, reload,
    addGarante: (g: NuevoGarante) =>
      ejecutar(supabase.from('customer_guarantors').insert(guarantorToRow({ ...g, customerId: customerId! }))),
    updateGarante: (id: string, g: NuevoGarante) =>
      ejecutar(supabase.from('customer_guarantors').update(guarantorToRow({ ...g, customerId: customerId! })).eq('id', id)),
    removeGarante: (id: string) => ejecutar(supabase.from('customer_guarantors').delete().eq('id', id)),
    addReferencia: (x: NuevaReferencia) =>
      ejecutar(supabase.from('customer_references').insert(referenceToRow({ ...x, customerId: customerId! }))),
    updateReferencia: (id: string, x: NuevaReferencia) =>
      ejecutar(supabase.from('customer_references').update(referenceToRow({ ...x, customerId: customerId! })).eq('id', id)),
    removeReferencia: (id: string) => ejecutar(supabase.from('customer_references').delete().eq('id', id)),
  };
}
