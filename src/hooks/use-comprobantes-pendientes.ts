'use client';

// Cuántos comprobantes de pago faltan por confirmar, para el número rojo de
// "Cobros" en el menú del super admin. Se vuelve a contar al volver a la
// pestaña, cada pocos minutos y cuando Cobros avisa que confirmó o rechazó uno.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

const EVENTO = 'sellalles:comprobantes-cambiaron';
const CADA_MS = 5 * 60 * 1000;

export function avisarCambioDeComprobantes() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function useComprobantesPendientes(activo: boolean): number {
  const [n, setN] = useState(0);

  const contar = useCallback(async () => {
    const { count, error } = await supabase
      .from('subscription_payment_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'por_confirmar');
    if (!error) setN(count ?? 0);
  }, []);

  useEffect(() => {
    if (!activo) { setN(0); return; }
    contar();
    const intervalo = window.setInterval(contar, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') contar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(EVENTO, contar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(EVENTO, contar);
    };
  }, [activo, contar]);

  return n;
}
