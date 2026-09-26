'use client';

// Bandeja de Cobros con los comprobantes que subieron las empresas y faltan
// por revisar, y los diálogos para confirmarlos o rechazarlos.
//
// Confirmar es lo único que crea el pago y su factura; hasta entonces no se
// factura nada. La factura por correo se pregunta en cada confirmación.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Loader2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ComprobanteVista } from '@/components/subscription/comprobante-vista';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { rowToSubscriptionPayment } from '@/lib/supabase/mappers';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import { codigoDeFactura } from '@/lib/subscription-invoice';
import { adminDeEmpresa, avisarPagoRechazado, enviarFactura, type Destinatario } from '@/lib/subscription-emails';
import { rowToReportePago, type ReportePago } from '@/lib/payment-reports';
import { montoProximaCuota, sumarMeses, type CobroEmpresa } from '@/lib/subscription-status';
import { fmtDate, fmtInstante } from '@/components/admin/cobros-fila';

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' });

/** Avisos para no confirmar dos veces la misma transferencia. */
function pistasDeDuplicado(r: ReportePago, todos: ReportePago[]): string[] {
  const otros = todos.filter((o) => o.id !== r.id && o.companyId === r.companyId && (o.status === 'confirmado' || o.status === 'por_confirmar'));
  const pistas: string[] = [];
  const ref = r.reference?.trim().toLowerCase();
  const mismaRef = ref ? otros.find((o) => o.reference?.trim().toLowerCase() === ref) : undefined;
  if (mismaRef) {
    pistas.push(`La referencia ${r.reference} ya está en otro comprobante (${mismaRef.status === 'confirmado' ? 'confirmado' : 'por confirmar'}, ${fmtDate(mismaRef.paidAt)}).`);
  }
  const mismoMonto = otros.find((o) => o !== mismaRef && o.paidAt === r.paidAt && Math.abs(o.amount - r.amount) < 0.01);
  if (mismoMonto) {
    pistas.push(`Hay otro comprobante del mismo monto y el mismo día (${mismoMonto.status === 'confirmado' ? 'confirmado' : 'por confirmar'}).`);
  }
  return pistas;
}

function resumenDeCuenta(c: CobroEmpresa | undefined): { texto: string; clase: string } | null {
  if (!c) return null;
  if (c.estado === 'atrasada' || c.estado === 'nunca_pago') {
    return {
      texto: `Debe ${formatCurrency(c.saldo)} · ${c.cuotasPendientes} ${c.cuotasPendientes === 1 ? 'cuota' : 'cuotas'} desde ${fmtDate(c.debeDesde)}`,
      clase: 'text-red-700 dark:text-red-400',
    };
  }
  if (c.estado === 'al_dia' || c.estado === 'por_vencer') {
    return {
      texto: `Al día · próxima cuota ${fmtDate(c.proximoCobro)} (${formatCurrency(montoProximaCuota(c))})`,
      clase: 'text-emerald-700 dark:text-emerald-400',
    };
  }
  if (c.estado === 'prueba' || c.estado === 'prueba_vencida') {
    return { texto: `En prueba · su plan es ${formatCurrency(c.mensual)}/mes`, clase: 'text-sky-700 dark:text-sky-400' };
  }
  return { texto: 'No tiene cuota configurada', clase: 'text-muted-foreground' };
}

export function BandejaPorConfirmar({ pendientes, todos, empresas, cuentas, onConfirmar, onRechazar }: {
  pendientes: ReportePago[];
  todos: ReportePago[];
  empresas: Record<string, Company>;
  cuentas: Record<string, CobroEmpresa>;
  onConfirmar: (r: ReportePago) => void;
  onRechazar: (r: ReportePago) => void;
}) {
  if (pendientes.length === 0) return null;
  const total = pendientes.reduce((acc, r) => acc + r.amount, 0);
  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="h-3 w-3 shrink-0 self-center rounded-full bg-amber-500" />
        <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400">Comprobantes por confirmar</h2>
        <span className="text-sm text-muted-foreground">({pendientes.length} · {formatCurrency(total)})</span>
        <span className="hidden text-xs text-muted-foreground lg:inline">· Verifica en el banco antes de confirmar: al confirmar se crea la factura</span>
      </div>
      <div className="space-y-2">
        {pendientes.map((r) => {
          const empresa = empresas[r.companyId];
          const cuenta = resumenDeCuenta(cuentas[r.companyId]);
          const pistas = pistasDeDuplicado(r, todos);
          return (
            <Card key={r.id} className="overflow-hidden border-l-[6px] border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/25">
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row">
                <ComprobanteVista reporte={r} />
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{empresa?.name ?? 'Empresa'}</span>
                    <span className="text-lg font-bold">{formatCurrency(r.amount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Transferido el {fmtDate(r.paidAt)}{r.bankLabel ? ` a ${r.bankLabel}` : ''}{r.reference ? ` · ref. ${r.reference}` : ''}
                  </p>
                  {r.notes && <p className="text-xs italic text-muted-foreground">“{r.notes}”</p>}
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> Lo subió {r.reportedByName ?? 'un administrador'} el {fmtHora(r.createdAt)}
                  </p>
                  {cuenta && <p className={cn('text-xs font-medium', cuenta.clase)}>{cuenta.texto}</p>}
                  {pistas.map((p) => (
                    <p key={p} className="flex items-start gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {p}
                    </p>
                  ))}
                </div>
                <div className="flex gap-2 sm:flex-col sm:justify-center">
                  <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onConfirmar(r)}>
                    <Check className="mr-1.5 h-4 w-4" /> Confirmar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400" onClick={() => onRechazar(r)}>
                    <X className="mr-1.5 h-4 w-4" /> Rechazar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function useDestinatario(companyId: string | undefined) {
  const [destinatario, setDestinatario] = useState<Destinatario | null | undefined>(undefined);
  useEffect(() => {
    if (!companyId) return;
    let cancelado = false;
    setDestinatario(undefined);
    adminDeEmpresa(companyId).then((d) => { if (!cancelado) setDestinatario(d); });
    return () => { cancelado = true; };
  }, [companyId]);
  return destinatario;
}

function TextoDestinatario({ destinatario, adjunto }: { destinatario: Destinatario | null | undefined; adjunto?: boolean }) {
  if (destinatario === undefined) return <>Buscando el correo del administrador…</>;
  if (!destinatario) return <>La empresa no tiene un administrador activo con correo: no se puede enviar.</>;
  return <>Le llega a {destinatario.name ? `${destinatario.name} ` : ''}&lt;{destinatario.email}&gt;{adjunto ? ', con el PDF adjunto' : ''}.</>;
}

export function ConfirmarComprobanteDialog({ reporte, company, cuenta, onClose, onDone }: {
  reporte: ReportePago | null;
  company: Company | undefined;
  cuenta: CobroEmpresa | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [activate, setActivate] = useState(false);
  const [quitarSoloVentas, setQuitarSoloVentas] = useState(false);
  const [enviarCorreo, setEnviarCorreo] = useState(true);
  const [saving, setSaving] = useState(false);
  const destinatario = useDestinatario(reporte?.companyId);

  const meses = cuenta?.ciclo === 'annual' ? 12 : 1;
  const periodoSugerido = useMemo(() => {
    if (!cuenta) return null;
    if (cuenta.pagarPendiente) return { desde: cuenta.pagarPendiente.desde, hasta: cuenta.pagarPendiente.hasta };
    if (cuenta.proximoCobro) return { desde: cuenta.proximoCobro, hasta: sumarMeses(cuenta.proximoCobro, meses) };
    return null;
  }, [cuenta, meses]);

  useEffect(() => {
    if (!reporte) return;
    setAmount(reporte.amount);
    setPeriodStart(periodoSugerido?.desde ?? '');
    setPeriodEnd(periodoSugerido?.hasta ?? '');
    setNotes('');
    // Activar solo a la que todavía no está activa (prueba): a una activa no
    // hace falta, y cambiarle el "pagado hasta" con un período viejo confunde.
    setActivate(!!company && company.status !== 'active');
    setQuitarSoloVentas(!!company?.solo_ventas && (cuenta?.saldo ?? 0) - reporte.amount <= 0.005);
    setEnviarCorreo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporte?.id]);

  const valor = Number(amount);
  const saldoDespues = cuenta ? Math.round((cuenta.saldo - (valor || 0)) * 100) / 100 : null;

  const confirmar = async () => {
    if (!reporte || !company) return;
    if (!valor || valor <= 0) {
      toast({ title: 'Monto inválido', description: 'Indica lo que llegó a la cuenta.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data: fila, error } = await supabase.rpc('confirmar_reporte_de_pago', {
        p_report_id: reporte.id,
        p_amount: valor,
        p_period_start: periodStart || null,
        p_period_end: periodEnd || null,
        p_activate: activate,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      const pago = rowToSubscriptionPayment(fila);

      if (quitarSoloVentas) {
        const { error: eSv } = await supabase.rpc('poner_solo_ventas', { p_company_id: company.id, p_activo: false });
        if (eSv) toast({ title: 'No se pudo quitar el modo solo ventas', description: eSv.message, variant: 'destructive' });
      }

      const correo = enviarCorreo && destinatario ? ` Enviando la factura a ${destinatario.email}.` : ' Sin correo: la factura está en su Mi Suscripción.';
      toast({
        title: 'Pago confirmado',
        description: `${company.name}: ${formatCurrency(pago.amount)}. Factura ${codigoDeFactura(pago)}.${correo}`,
      });
      if (enviarCorreo && destinatario) {
        void enviarFactura(company, pago).catch((err: any) => {
          toast({ title: 'El pago se confirmó, pero no se envió la factura', description: err?.message ?? 'Error enviando el correo.', variant: 'destructive' });
        });
      }
      onDone();
      onClose();
    } catch (err: any) {
      toast({ title: 'No se pudo confirmar', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!reporte} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar pago — {company?.name}</DialogTitle>
          <DialogDescription>
            Confirma solo si ya viste el dinero en la cuenta. Al confirmar se registra el pago y se crea su factura.
          </DialogDescription>
        </DialogHeader>
        {reporte && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
              <ComprobanteVista reporte={reporte} grande />
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">Reportó:</span> <strong>{formatCurrency(reporte.amount)}</strong></p>
                <p><span className="text-muted-foreground">Fecha:</span> {fmtDate(reporte.paidAt)}</p>
                {reporte.bankLabel && <p><span className="text-muted-foreground">Cuenta:</span> {reporte.bankLabel}</p>}
                {reporte.reference && <p><span className="text-muted-foreground">Referencia:</span> {reporte.reference}</p>}
                {reporte.notes && <p className="italic text-muted-foreground">“{reporte.notes}”</p>}
                {cuenta && cuenta.saldo > 0 && (
                  <p className="pt-2 text-red-700 dark:text-red-400">Debía {formatCurrency(cuenta.saldo)} ({cuenta.cuotasPendientes} {cuenta.cuotasPendientes === 1 ? 'cuota' : 'cuotas'}).</p>
                )}
                {saldoDespues != null && valor > 0 && (
                  <p className={cn('font-medium', saldoDespues > 0.005 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
                    {saldoDespues > 0.005
                      ? `Después de este pago seguiría debiendo ${formatCurrency(saldoDespues)}.`
                      : saldoDespues < -0.005
                        ? `Queda al día, con ${formatCurrency(-saldoDespues)} a favor.`
                        : 'Queda al día.'}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="cc-monto">Monto que llegó *</Label>
                <Input id="cc-monto" type="number" step="0.01" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cc-desde">Período desde</Label>
                <Input id="cc-desde" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cc-hasta">Período hasta</Label>
                <Input id="cc-hasta" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              El período sale en la factura. La cuenta de la empresa se calcula por lo pagado, cuota por cuota.
            </p>

            <div className="space-y-1">
              <Label htmlFor="cc-notas">Nota interna (opcional)</Label>
              <Textarea id="cc-notas" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {company?.status !== 'active' && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="cc-activar" className="font-normal">Activar la empresa</Label>
                  <p className="text-xs text-muted-foreground">Está en {company?.status === 'trial' ? 'prueba' : 'estado suspendida'}: pasa a Activa.</p>
                </div>
                <Switch id="cc-activar" checked={activate} onCheckedChange={setActivate} />
              </div>
            )}

            {company?.solo_ventas && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="cc-sv" className="font-normal">Quitarle el modo solo ventas</Label>
                  <p className="text-xs text-muted-foreground">Está en solo ventas desde el {fmtInstante(company.solo_ventas_desde)}.</p>
                </div>
                <Switch id="cc-sv" checked={quitarSoloVentas} onCheckedChange={setQuitarSoloVentas} />
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="cc-correo" className="font-normal">Enviar la factura por correo</Label>
                <p className="text-xs text-muted-foreground">
                  <TextoDestinatario destinatario={destinatario} adjunto /> Si no se envía, la descarga igual desde Mi Suscripción.
                </p>
              </div>
              <Switch id="cc-correo" checked={enviarCorreo && !!destinatario} disabled={!destinatario} onCheckedChange={setEnviarCorreo} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={confirmar} disabled={saving || !valor}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Confirmar y facturar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVOS = [
  'La transferencia no ha llegado a la cuenta.',
  'El monto no coincide con lo que llegó.',
  'El comprobante no se ve bien.',
  'Este comprobante ya se había registrado.',
];

export function RechazarComprobanteDialog({ reporte, company, onClose, onDone }: {
  reporte: ReportePago | null;
  company: Company | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [saving, setSaving] = useState(false);
  const destinatario = useDestinatario(reporte?.companyId);

  useEffect(() => { if (reporte) { setMotivo(''); setAvisar(true); } }, [reporte?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rechazar = async () => {
    if (!reporte || !company) return;
    const texto = motivo.trim();
    if (texto.length < 3) {
      toast({ title: 'Falta el motivo', description: 'La empresa lo va a ver en Mi Suscripción.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('rechazar_reporte_de_pago', { p_report_id: reporte.id, p_motivo: texto });
      if (error) throw error;
      toast({ title: 'Comprobante rechazado', description: `${company.name} lo verá en Mi Suscripción.` });
      if (avisar && destinatario) {
        void avisarPagoRechazado(company, rowToReportePago(data), texto).catch((err: any) => {
          toast({ title: 'Se rechazó, pero no se envió el correo', description: err?.message ?? 'Error enviando el correo.', variant: 'destructive' });
        });
      }
      onDone();
      onClose();
    } catch (err: any) {
      toast({ title: 'No se pudo rechazar', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!reporte} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechazar comprobante — {company?.name}</DialogTitle>
          <DialogDescription>
            {reporte && <>{formatCurrency(reporte.amount)} del {fmtDate(reporte.paidAt)}. </>}
            No se registra ningún pago. La empresa ve el motivo y puede subir otro.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS.map((m) => (
              <Button key={m} type="button" size="sm" variant="outline" className="h-auto whitespace-normal py-1 text-left text-xs" onClick={() => setMotivo(m)}>
                {m}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="rc-motivo">Motivo *</Label>
            <Textarea id="rc-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Lo va a leer el cliente." />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="rc-correo" className="font-normal">Avisarle por correo</Label>
              <p className="text-xs text-muted-foreground"><TextoDestinatario destinatario={destinatario} /></p>
            </div>
            <Switch id="rc-correo" checked={avisar && !!destinatario} disabled={!destinatario} onCheckedChange={setAvisar} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="destructive" onClick={rechazar} disabled={saving || motivo.trim().length < 3}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
