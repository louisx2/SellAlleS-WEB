'use client';

// Aviso del cupo mensual de comprobantes electrónicos, para el administrador de
// una empresa con e-CF. Sale cuando se acerca al límite (ámbar, se puede ocultar
// por hoy) y cuando ya lo alcanzó (rojo, no se oculta). "Saber más" explica qué
// pasa con lo que se facture después del límite; "Contactar a soporte" abre
// WhatsApp (o el correo) para ampliar el plan.
//
// El uso sale de ecf_cupo_del_mes(), que mira la empresa actual (también la
// impersonada). Se vuelve a pedir al volver a la pestaña y cada pocos minutos.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Gauge, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { avisoDeCupoEcf, type AvisoCupoEcf, type CupoEcfMes } from '@/lib/ecf';
import { supportMailto, waLink } from '@/lib/support-contact';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const CADA_MS = 5 * 60 * 1000;
const ZONA = 'America/Santo_Domingo';

// El cupo reinicia a las 00:00 UTC del día 1: se muestra ese día, no la víspera local.
const fechaRenueva = (d: Date) => d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fechaLocal = (d: Date) => d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone: ZONA });
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
const comprobantes = (n: number) => `${n} ${n === 1 ? 'comprobante' : 'comprobantes'}`;

const ESTILO = {
  agotado: {
    caja: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
    icono: 'text-red-600 dark:text-red-400',
    boton: 'bg-red-600 text-white hover:bg-red-700',
  },
  por_agotarse: {
    caja: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
    icono: 'text-amber-600 dark:text-amber-400',
    boton: 'bg-amber-500 text-white hover:bg-amber-600',
  },
} as const;

function textos(a: AvisoCupoEcf): { titulo: string; detalle: string } {
  const uso = `Ha emitido ${a.usados} de los ${comprobantes(a.cupo)} electrónicos incluidos en su plan este mes.`;
  if (a.nivel === 'agotado') {
    const pendientes = a.pendientes > 0
      ? ` Hay ${comprobantes(a.pendientes)} pendiente${a.pendientes === 1 ? '' : 's'} de envío.`
      : '';
    return {
      titulo: 'Se alcanzó el límite mensual de comprobantes electrónicos',
      detalle:
        `Puede seguir facturando, pero los comprobantes nuevos no se enviarán a la DGII hasta que se amplíe su plan `
        + `o se renueve el límite el ${fechaRenueva(a.renueva)}.${pendientes} Contacte a soporte para ampliarlo.`,
    };
  }
  const ritmo = a.agotaAprox
    ? ` Al ritmo actual, el límite se alcanzaría alrededor del ${fechaLocal(a.agotaAprox)}.`
    : ` El límite se renueva el ${fechaRenueva(a.renueva)}.`;
  return {
    titulo: 'Se está acercando al límite mensual de comprobantes electrónicos',
    detalle: `${uso}${ritmo} Si necesitará más, contacte a soporte para ampliar su plan.`,
  };
}

export function EcfCupoBanner({ companyId }: { companyId?: string }) {
  const { support } = usePlatformSettings();
  const [cupo, setCupo] = useState<CupoEcfMes | null>(null);
  const [oculto, setOculto] = useState(true);
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  const cargar = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase.rpc('ecf_cupo_del_mes');
    if (!error) setCupo(((data as CupoEcfMes[] | null) ?? [])[0] ?? null);
  }, [companyId]);

  useEffect(() => {
    setCupo(null);
    cargar();
    const intervalo = window.setInterval(cargar, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  const aviso = avisoDeCupoEcf(cupo, new Date());
  const ocultable = aviso?.nivel === 'por_agotarse';
  const clave = aviso ? `avisoCupoEcfOculto:${companyId}:${aviso.nivel}` : '';

  useEffect(() => {
    if (!aviso) return;
    if (!ocultable) { setOculto(false); return; }
    try {
      setOculto(localStorage.getItem(clave) === hoyLocal());
    } catch {
      setOculto(false);
    }
  }, [clave, ocultable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aviso) return null;

  const e = ESTILO[aviso.nivel];
  const { titulo, detalle } = textos(aviso);
  const mensaje = 'Hola, quisiera ampliar el límite mensual de comprobantes electrónicos de mi empresa.';
  const enlaceSoporte = waLink(support, mensaje) ?? supportMailto(support, 'Ampliar límite de comprobantes electrónicos');

  const ocultar = () => {
    try { localStorage.setItem(clave, hoyLocal()); } catch { /* sin storage: solo se cierra ahora */ }
    setOculto(true);
  };

  const botonSoporte = (clase?: string) =>
    enlaceSoporte ? (
      <Button asChild size="sm" className={clase}>
        <a href={enlaceSoporte} target="_blank" rel="noopener noreferrer">Contactar a soporte</a>
      </Button>
    ) : null;

  return (
    <>
      {!oculto && (
        <div role="status" className={cn('mb-4 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center', e.caja)}>
          {aviso.nivel === 'agotado'
            ? <AlertTriangle className={cn('hidden h-5 w-5 shrink-0 sm:block', e.icono)} />
            : <Gauge className={cn('hidden h-5 w-5 shrink-0 sm:block', e.icono)} />}
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{titulo}</p>
            <p className="opacity-90">{detalle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 bg-transparent sm:flex-none"
              onClick={() => setDetalleAbierto(true)}
            >
              Saber más
            </Button>
            {botonSoporte(cn('flex-1 sm:flex-none', e.boton))}
            {ocultable && (
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={ocultar} aria-label="Ocultar por hoy" title="Ocultar por hoy">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={detalleAbierto} onOpenChange={setDetalleAbierto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>¿Qué ocurre al alcanzar el límite mensual?</DialogTitle>
            <DialogDescription>
              Su plan incluye {comprobantes(aviso.cupo)} electrónicos al mes. Este mes lleva {aviso.usados}.
              El límite se renueva el {fechaRenueva(aviso.renueva)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <section className="space-y-1">
              <h3 className="font-semibold">Qué cuenta para el límite</h3>
              <p className="text-muted-foreground">
                Todas las facturas y notas de crédito electrónicas que emite la empresa, en todas sus sucursales.
                Anular una venta genera una nota de crédito, que también cuenta.
              </p>
            </section>

            <section className="space-y-1">
              <h3 className="font-semibold">Al superar el límite</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Puede seguir vendiendo con normalidad: cada venta se registra y recibe su número de comprobante (e-NCF).
                </li>
                <li>
                  Esos comprobantes <strong className="text-foreground">no se envían a la DGII</strong> hasta que se amplíe
                  su plan o se renueve el límite. Quedan en estado &ldquo;Sin cupo&rdquo; en Movimientos.
                </li>
                <li>
                  La factura se imprime sin código QR ni código de seguridad, con la nota &ldquo;pendiente&rdquo;.
                </li>
                <li>
                  Mientras no sea aceptado por la DGII, el comprobante no tiene validez fiscal. Un cliente con Crédito
                  Fiscal (RNC) no podrá validarlo ni usarlo para su crédito fiscal en ese tiempo.
                </li>
              </ul>
            </section>

            <section className="space-y-1">
              <h3 className="font-semibold">Cuando se amplía el plan o se renueva el límite</h3>
              <p className="text-muted-foreground">
                Los comprobantes pendientes se envían a la DGII automáticamente, en el orden en que se emitieron y con
                su mismo número y fecha. Después puede reimprimirlos con el código QR desde Movimientos.
              </p>
            </section>

            <section className="space-y-1">
              <h3 className="font-semibold">Recomendación</h3>
              <p className="text-muted-foreground">
                Si prevé necesitar más comprobantes, contacte a soporte antes de alcanzar el límite. Así ampliamos su
                plan sin que ninguna factura quede pendiente.
              </p>
            </section>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDetalleAbierto(false)}>Cerrar</Button>
            {botonSoporte()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
