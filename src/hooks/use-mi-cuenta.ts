'use client';

// La cuenta de la suscripción de la empresa activa, para su administrador: la
// misma que ve el super admin en Cobros (mi_cuenta_de_suscripcion). Para
// cualquier otro usuario devuelve null.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { cuentaDesdeJson, type CobroEmpresa } from '@/lib/subscription-status';

const EVENTO = 'sellalles:mi-cuenta-cambio';

/** Tras reportar o retirar un pago: el aviso de arriba se actualiza solo. */
export function avisarCambioDeMiCuenta() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function useMiCuenta(activo: boolean, companyId?: string) {
  const [cuenta, setCuenta] = useState<CobroEmpresa | null>(null);
  const [cargando, setCargando] = useState(activo);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('mi_cuenta_de_suscripcion');
    setCuenta(!error && data ? cuentaDesdeJson(data) : null);
    setCargando(false);
  }, []);

  useEffect(() => {
    if (!activo) { setCuenta(null); setCargando(false); return; }
    setCargando(true);
    cargar();
    window.addEventListener(EVENTO, cargar);
    return () => window.removeEventListener(EVENTO, cargar);
  }, [activo, companyId, cargar]);

  return { cuenta, cargando, recargar: cargar };
}
