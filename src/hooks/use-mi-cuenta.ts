'use client';

// La cuenta de la suscripción de la empresa activa, para su administrador: la
// misma que ve el super admin en Cobros (mi_cuenta_de_suscripcion). Para
// cualquier otro usuario devuelve null.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { cuentaDesdeJson, type CobroEmpresa } from '@/lib/subscription-status';
import { useRealtimeReload } from '@/lib/use-realtime-reload';

const EVENTO = 'sellalles:mi-cuenta-cambio';

/** Tras reportar o retirar un pago: el aviso de arriba se actualiza solo. */
export function avisarCambioDeMiCuenta() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function useMiCuenta(activo: boolean, companyId?: string) {
  const [cuenta, setCuenta] = useState<CobroEmpresa | null>(null);
  const [cargando, setCargando] = useState(activo);

  // silencioso: si la recarga falla se deja la cuenta que había (un error de
  // red al volver a la pestaña no debe borrar el aviso ni el monto sugerido).
  const cargar = useCallback(async (silencioso = false) => {
    const { data, error } = await supabase.rpc('mi_cuenta_de_suscripcion');
    if (error && silencioso) return;
    setCuenta(!error && data ? cuentaDesdeJson(data) : null);
    setCargando(false);
  }, []);

  useEffect(() => {
    if (!activo) { setCuenta(null); setCargando(false); return; }
    setCargando(true);
    cargar();
    const alCambiar = () => { void cargar(); };
    window.addEventListener(EVENTO, alCambiar);
    return () => window.removeEventListener(EVENTO, alCambiar);
  }, [activo, companyId, cargar]);

  // En tiempo real: cuando se confirma o rechaza un comprobante, o se registra
  // un pago, el aviso de arriba y Mi Suscripción se ponen al día sin recargar.
  // Realtime solo entrega las filas de esta empresa (las mismas políticas).
  const recargarEnSilencio = useCallback(() => cargar(true), [cargar]);
  useRealtimeReload(['subscription_payment_reports', 'subscription_payments'], recargarEnSilencio, activo);

  const recargar = useCallback(() => cargar(), [cargar]);
  return { cuenta, cargando, recargar };
}
