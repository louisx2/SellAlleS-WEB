'use client';

// Aviso para los administradores de una empresa con e-CF: hay comprobantes que la
// DGII rechazó o que no salieron (error en los datos, sin cupo) y que el servidor
// no reintenta solo. Cuenta los documentos vigentes (los que nadie ha reemplazado)
// en esos estados y lleva a Movimientos ya filtrado. Quien lo monta decide a quién
// se le muestra; aquí solo se cuenta.
//
// Se vuelve a contar al volver a la pestaña, cada pocos minutos y cuando el
// detalle de una venta avisa que reintentó o reemitió un comprobante.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ECF_ESTADOS_CON_PROBLEMA } from '@/lib/ecf';
import { Button } from '@/components/ui/button';

const EVENTO = 'sellalles:ecf-cambio';
const CADA_MS = 5 * 60 * 1000;

/** Tras reintentar o reemitir un comprobante: el aviso de arriba se actualiza solo. */
export function avisarCambioDeEcf() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO));
}

export function EcfProblemasBanner({ companyId }: { companyId?: string }) {
  const [n, setN] = useState(0);

  const contar = useCallback(async () => {
    if (!companyId) return;
    // La empresa se pide aparte de la RLS: un super admin dentro de una empresa
    // vería, si no, los documentos de todas.
    const { count, error } = await supabase
      .from('ecf_documentos')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('reemplazado_por', null)
      .in('estado', ECF_ESTADOS_CON_PROBLEMA);
    if (!error) setN(count ?? 0);
  }, [companyId]);

  useEffect(() => {
    setN(0);
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
  }, [contar]);

  if (n === 0) return null;

  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="hidden h-5 w-5 shrink-0 text-red-600 dark:text-red-400 sm:block" />
      <p className="min-w-0 flex-1 text-sm font-semibold">
        Hay {n} comprobante(s) electrónico(s) con problemas.
      </p>
      <Button asChild size="sm" className="bg-red-600 text-white hover:bg-red-700 sm:flex-none">
        <Link href="/sales?filtro=ecf-problemas">Ver en Movimientos</Link>
      </Button>
    </div>
  );
}
