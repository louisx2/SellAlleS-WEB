'use client';

// Aviso de la cuota para los administradores de la empresa, arriba de cada
// pantalla. Solo lo ve quien puede pagar (el admin); los cajeros no.
//
// Colores: rojo si debe cuotas vencidas o está en solo ventas, ámbar si la
// próxima cuota llega en pocos días, azul si ya subió un comprobante y lo
// estamos revisando. El ámbar y el azul se pueden ocultar por hoy; el rojo no.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Hourglass, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency } from '@/lib/utils';
import { hoyLocal, montoProximaCuota, type CobroEmpresa } from '@/lib/subscription-status';

const fmt = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }) : '');
const cuotas = (n: number) => `${n} ${n === 1 ? 'cuota pendiente' : 'cuotas pendientes'}`;

type Tono = 'rojo' | 'ambar' | 'azul';

const ESTILO: Record<Tono, { caja: string; icono: string; boton: string }> = {
  rojo: {
    caja: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
    icono: 'text-red-600 dark:text-red-400',
    boton: 'bg-red-600 text-white hover:bg-red-700',
  },
  ambar: {
    caja: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
    icono: 'text-amber-600 dark:text-amber-400',
    boton: 'bg-amber-500 text-white hover:bg-amber-600',
  },
  azul: {
    caja: 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
    icono: 'text-sky-600 dark:text-sky-400',
    boton: 'bg-sky-600 text-white hover:bg-sky-700',
  },
};

interface Aviso { tono: Tono; icono: typeof AlertTriangle; titulo: string; detalle: string; ocultable: boolean; clave: string }

export function avisoDeCuota(c: CobroEmpresa | null): Aviso | null {
  if (!c) return null;
  const debe = c.estado === 'atrasada' || c.estado === 'nunca_pago';
  const enRevision = c.comprobantesPorConfirmar > 0;

  if (c.soloVentas) {
    return {
      tono: 'rojo', icono: Lock, ocultable: false, clave: 'solo-ventas',
      titulo: 'Tu cuenta está en modo solo ventas',
      detalle: enRevision
        ? `Puedes vender, cobrar y usar la caja. Estamos revisando tu comprobante de ${formatCurrency(c.porConfirmar)}.`
        : `Puedes vender, cobrar y usar la caja; lo demás queda en consulta hasta ponerte al día${debe ? ` (${cuotas(c.cuotasPendientes)}, ${formatCurrency(c.saldo)})` : ''}.`,
    };
  }
  if (enRevision && (!debe || c.porConfirmar + 0.005 >= c.saldo)) {
    return {
      tono: 'azul', icono: Hourglass, ocultable: true, clave: `revision:${c.comprobantesPorConfirmar}`,
      titulo: `Estamos revisando tu comprobante de ${formatCurrency(c.porConfirmar)}`,
      detalle: 'Cuando confirmemos que llegó a la cuenta te llega la factura por correo.',
    };
  }
  if (debe) {
    return {
      tono: 'rojo', icono: AlertTriangle, ocultable: false, clave: 'debe',
      titulo: `Tienes ${cuotas(c.cuotasPendientes)}: ${formatCurrency(c.saldo)}`,
      detalle: enRevision
        ? `Recibimos un comprobante de ${formatCurrency(c.porConfirmar)} y lo estamos revisando; aún faltarían ${formatCurrency(c.saldo - c.porConfirmar)}.`
        : `Desde el ${fmt(c.debeDesde)}. Transfiere y sube el comprobante en Mi Suscripción.`,
    };
  }
  if (c.estado === 'por_vencer' && c.dias != null) {
    return {
      tono: 'ambar', icono: CalendarClock, ocultable: true, clave: `vence:${c.proximoCobro}`,
      titulo: c.dias === 0
        ? `Tu cuota de ${formatCurrency(montoProximaCuota(c))} vence hoy`
        : `Tu próxima cuota de ${formatCurrency(montoProximaCuota(c))} vence el ${fmt(c.proximoCobro)}`,
      detalle: c.dias === 0 ? 'Transfiere y sube el comprobante en Mi Suscripción.' : `En ${c.dias} ${c.dias === 1 ? 'día' : 'días'}. Cuando transfieras, sube el comprobante en Mi Suscripción.`,
    };
  }
  return null;
}

const claveOculto = (clave: string) => `avisoCuotaOculto:${clave}`;

export function AvisoDeCuota({ cuenta, className }: { cuenta: CobroEmpresa | null; className?: string }) {
  const aviso = avisoDeCuota(cuenta);
  const [oculto, setOculto] = useState(true);

  useEffect(() => {
    if (!aviso) return;
    if (!aviso.ocultable) { setOculto(false); return; }
    try {
      setOculto(localStorage.getItem(claveOculto(aviso.clave)) === hoyLocal());
    } catch {
      setOculto(false);
    }
  }, [aviso?.clave, aviso?.ocultable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aviso || oculto) return null;
  const e = ESTILO[aviso.tono];
  const Icono = aviso.icono;

  const ocultar = () => {
    try { localStorage.setItem(claveOculto(aviso.clave), hoyLocal()); } catch { /* sin storage: solo se cierra ahora */ }
    setOculto(true);
  };

  return (
    <div role="status" className={cn('mb-4 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center', e.caja, className)}>
      <Icono className={cn('hidden h-5 w-5 shrink-0 sm:block', e.icono)} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{aviso.titulo}</p>
        <p className="opacity-90">{aviso.detalle}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button asChild size="sm" className={cn('flex-1 sm:flex-none', e.boton)}>
          <Link href="/suscripcion">{aviso.tono === 'azul' ? 'Ver estado' : 'Pagar / subir comprobante'}</Link>
        </Button>
        {aviso.ocultable && (
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={ocultar} aria-label="Ocultar por hoy" title="Ocultar por hoy">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
