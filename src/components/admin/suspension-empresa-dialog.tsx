'use client';

// Suspender o reactivar una empresa (solo super admin). Al suspender se elige
// el motivo, que decide lo que la empresa ve en su pantalla. Al reactivar se
// elige cómo queda: en prueba hasta una fecha, o activa (con o sin modo solo
// facturación). En los dos casos el correo al administrador de la empresa es
// opcional y está apagado de entrada: se decide cada vez.
//
// Todo pasa por suspender_empresa / reactivar_empresa (migración
// 20261116150000_empresa_suspendida.sql), que validan al super admin.

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Company } from '@/lib/types';
import {
  MOTIVOS_SUSPENSION, MOTIVO_SUSPENSION_INFO, esMotivoSuspension, fechaMasDias, reactivacionSugerida,
  type MotivoSuspension,
} from '@/lib/suspension';
import { cn } from '@/lib/utils';

interface Props {
  company: Company | null;
  onClose: () => void;
  /** Tras guardar: recargar la lista. */
  onDone: () => void | Promise<void>;
}

const fechaLarga = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export function SuspensionEmpresaDialog({ company, onClose, onDone }: Props) {
  const { toast } = useToast();
  const reactivar = company?.status === 'suspended';

  const [motivo, setMotivo] = useState<MotivoSuspension>('falta_de_pago');
  const [estado, setEstado] = useState<'trial' | 'active'>('active');
  const [pruebaHasta, setPruebaHasta] = useState('');
  const [soloFacturacion, setSoloFacturacion] = useState(false);
  const [avisar, setAvisar] = useState(false);
  const [correo, setCorreo] = useState<{ email: string; nombre: string | null } | null | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);

  // Al abrir: valores de partida y a quién le llegaría el correo.
  useEffect(() => {
    if (!company) return;
    setMotivo('falta_de_pago');
    setAvisar(false);
    const s = reactivacionSugerida({ motivo: company.suspension_reason, finPrueba: company.trial_ends_at });
    setEstado(s.estado);
    setPruebaHasta(s.pruebaHasta);
    setSoloFacturacion(s.soloFacturacion);
    setCorreo(undefined);
    let vivo = true;
    supabase.rpc('correo_admin_de_empresa', { p_company: company.id }).then(({ data }) => {
      if (!vivo) return;
      const fila = (data as { email: string; user_name: string | null }[] | null)?.[0];
      setCorreo(fila?.email ? { email: fila.email, nombre: fila.user_name } : null);
    });
    return () => { vivo = false; };
  }, [company]);

  if (!company) return null;

  const hoy = fechaMasDias(0);
  const pruebaYaVencida = estado === 'trial' && !!pruebaHasta && pruebaHasta < hoy;

  const guardar = async () => {
    if (!reactivar) {
      setGuardando(true);
      const { error } = await supabase.rpc('suspender_empresa', {
        p_company: company.id, p_motivo: motivo, p_avisar: avisar && !!correo,
      });
      setGuardando(false);
      if (error) {
        toast({ title: 'No se pudo suspender', description: error.message, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Empresa suspendida',
        description: `${company.name}${avisar && correo ? ` · se avisó a ${correo.email}` : ''}`,
      });
    } else {
      if (estado === 'trial' && !pruebaHasta) {
        toast({ title: 'Falta la fecha', description: 'Indique hasta cuándo va la prueba.', variant: 'destructive' });
        return;
      }
      setGuardando(true);
      const { error } = await supabase.rpc('reactivar_empresa', {
        p_company: company.id,
        p_estado: estado,
        p_prueba_hasta: estado === 'trial' ? pruebaHasta : null,
        p_solo_facturacion: estado === 'active' && soloFacturacion,
        p_avisar: avisar && !!correo,
      });
      setGuardando(false);
      if (error) {
        toast({ title: 'No se pudo reactivar', description: error.message, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Empresa reactivada',
        description: `${company.name}${avisar && correo ? ` · se avisó a ${correo.email}` : ''}`,
      });
    }
    onClose();
    await onDone();
  };

  const motivoActual = esMotivoSuspension(company.suspension_reason)
    ? MOTIVO_SUSPENSION_INFO[company.suspension_reason].nombre
    : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reactivar ? `Reactivar ${company.name}` : `Suspender ${company.name}`}</DialogTitle>
          <DialogDescription>
            {reactivar
              ? [motivoActual && `Suspendida por ${motivoActual.toLowerCase()}`, fechaLarga(company.suspended_at) && `desde el ${fechaLarga(company.suspended_at)}`]
                  .filter(Boolean).join(', ') || 'Elija cómo queda la empresa al reactivarla.'
              : 'Sus usuarios dejarán de tener acceso en menos de un minuto.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {!reactivar ? (
            <>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <RadioGroup value={motivo} onValueChange={(v) => setMotivo(v as MotivoSuspension)} className="gap-2">
                  {MOTIVOS_SUSPENSION.map((m) => (
                    <Label
                      key={m}
                      htmlFor={`motivo-${m}`}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal',
                        motivo === m && 'border-primary bg-primary/5',
                      )}
                    >
                      <RadioGroupItem id={`motivo-${m}`} value={m} className="mt-0.5" />
                      <span className="space-y-0.5">
                        <span className="block font-medium">{MOTIVO_SUSPENSION_INFO[m].nombre}</span>
                        <span className="block text-xs text-muted-foreground">{MOTIVO_SUSPENSION_INFO[m].descripcion}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>

              <div className="rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Mientras esté suspendida</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>Sus usuarios ven una pantalla de cuenta suspendida y no pueden vender ni hacer cambios.</li>
                  <li>Se pausan los recordatorios de cuotas a sus clientes.</li>
                  <li>Los comprobantes electrónicos ya emitidos se siguen enviando a la DGII.</li>
                  <li>No se borra ningún dato. Usted puede seguir entrando a la empresa.</li>
                </ul>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label>¿Cómo queda la empresa?</Label>
              <RadioGroup value={estado} onValueChange={(v) => setEstado(v as 'trial' | 'active')} className="gap-2">
                <Label
                  htmlFor="estado-active"
                  className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal', estado === 'active' && 'border-primary bg-primary/5')}
                >
                  <RadioGroupItem id="estado-active" value="active" className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">Activa</span>
                    <span className="block text-xs text-muted-foreground">Cliente de pago. Los cobros siguen su plan en Cobros.</span>
                  </span>
                </Label>
                {estado === 'active' && (
                  <label className="ml-7 flex cursor-pointer items-start gap-2 text-xs">
                    <Checkbox
                      checked={soloFacturacion}
                      onCheckedChange={(v) => setSoloFacturacion(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Solo facturación hasta que pague.</span>{' '}
                      <span className="text-muted-foreground">Puede vender, pero el resto de las funciones queda cerrado hasta que se quite en Cobros.</span>
                    </span>
                  </label>
                )}
                <Label
                  htmlFor="estado-trial"
                  className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal', estado === 'trial' && 'border-primary bg-primary/5')}
                >
                  <RadioGroupItem id="estado-trial" value="trial" className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">Prueba gratis</span>
                    <span className="block text-xs text-muted-foreground">Acceso completo hasta la fecha que indique.</span>
                  </span>
                </Label>
                {estado === 'trial' && (
                  <div className="ml-7 space-y-1">
                    <Label htmlFor="prueba-hasta" className="text-xs">Prueba hasta</Label>
                    <Input
                      id="prueba-hasta"
                      type="date"
                      value={pruebaHasta}
                      onChange={(e) => setPruebaHasta(e.target.value)}
                      className="w-44"
                    />
                    {pruebaYaVencida && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Esa fecha ya pasó: la empresa entrará en modo solo facturación (prueba vencida).
                      </p>
                    )}
                  </div>
                )}
              </RadioGroup>
            </div>
          )}

          <div className="space-y-1 border-t pt-4">
            {correo === undefined ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando el correo del administrador…
              </p>
            ) : correo ? (
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox checked={avisar} onCheckedChange={(v) => setAvisar(v === true)} className="mt-0.5" />
                <span className="text-sm">
                  Enviar aviso por correo a <span className="font-medium">{correo.email}</span>
                  {correo.nombre ? <span className="text-muted-foreground"> ({correo.nombre})</span> : null}
                  <span className="block text-xs text-muted-foreground">
                    {reactivar
                      ? 'Le confirma que la cuenta está reactivada y cómo queda.'
                      : motivo === 'falta_de_pago'
                        ? 'Le explica la suspensión e incluye las cuentas para transferir.'
                        : 'Le explica la suspensión y cómo comunicarse con soporte.'}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">
                La empresa no tiene un administrador con correo válido: no se enviará aviso.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button
            onClick={guardar}
            disabled={guardando}
            className={reactivar ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
          >
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {reactivar ? 'Reactivar' : 'Suspender'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
