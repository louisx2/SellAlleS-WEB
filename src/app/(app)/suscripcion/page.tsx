'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase/client';
import { rowToSubscriptionPayment } from '@/lib/supabase/mappers';
import type { SubscriptionPayment } from '@/lib/types';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings } from '@/context/platform-settings-provider';
import { waLink } from '@/lib/support-contact';
import { cn, formatCurrency } from '@/lib/utils';
import { METODO_DE_PAGO, codigoDeFactura, descargarFactura } from '@/lib/subscription-invoice';
import { montoProximaCuota, type CobroEmpresa } from '@/lib/subscription-status';
import {
  ESTADO_REPORTE, TIPO_DE_CUENTA, cargarCuentasBancarias, rowToReportePago,
  type CuentaBancaria, type ReportePago,
} from '@/lib/payment-reports';
import { useMiCuenta, avisarCambioDeMiCuenta } from '@/hooks/use-mi-cuenta';
import { ReportarPagoDialog } from '@/components/subscription/reportar-pago-dialog';
import { ComprobanteVista } from '@/components/subscription/comprobante-vista';
import {
  CheckCircle2, Clock, AlertTriangle, Download, Loader2, Lock, Copy, Check, Landmark, Paperclip, Hourglass, Store,
} from 'lucide-react';

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const fmtLargo = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }) : '');
const cuotasTxt = (n: number) => `${n} ${n === 1 ? 'cuota' : 'cuotas'}`;

type Tono = 'rojo' | 'ambar' | 'verde' | 'azul' | 'gris';
const TONO: Record<Tono, { caja: string; texto: string; icono: string }> = {
  rojo: { caja: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40', texto: 'text-red-700 dark:text-red-400', icono: 'text-red-600' },
  ambar: { caja: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40', texto: 'text-amber-700 dark:text-amber-400', icono: 'text-amber-600' },
  verde: { caja: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40', texto: 'text-emerald-700 dark:text-emerald-400', icono: 'text-emerald-600' },
  azul: { caja: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40', texto: 'text-sky-700 dark:text-sky-400', icono: 'text-sky-600' },
  gris: { caja: '', texto: 'text-muted-foreground', icono: 'text-muted-foreground' },
};

/** Qué decirle al cliente de su cuenta, y cuánto proponerle al reportar. */
function resumen(c: CobroEmpresa): { tono: Tono; titulo: string; detalle: string; monto: number | null; notaMonto?: string } {
  switch (c.estado) {
    case 'atrasada':
    case 'nunca_pago': {
      const falta = Math.max(c.saldo - c.porConfirmar, 0);
      return {
        tono: 'rojo',
        titulo: `Debes ${formatCurrency(c.saldo)}`,
        detalle: `${cuotasTxt(c.cuotasPendientes)} sin pagar, desde el ${fmtLargo(c.debeDesde)}. Pagándolo quedas al día hasta el ${fmtLargo(c.pagarPendiente?.hasta)}.`,
        monto: falta > 0 ? falta : c.saldo,
        notaMonto: `Es lo que debes${c.porConfirmar > 0 ? ', menos lo que ya reportaste' : ''}. Si pagaste otro monto, cámbialo.`,
      };
    }
    case 'por_vencer':
      return {
        tono: 'ambar',
        titulo: c.dias === 0 ? 'Tu cuota vence hoy' : `Tu cuota vence ${c.dias === 1 ? 'mañana' : `en ${c.dias} días`}`,
        detalle: `Próxima cuota: ${formatCurrency(montoProximaCuota(c))} el ${fmtLargo(c.proximoCobro)}.`,
        monto: montoProximaCuota(c),
        notaMonto: 'Es tu próxima cuota. Si pagaste más meses, cámbialo.',
      };
    case 'al_dia':
      return {
        tono: 'verde',
        titulo: 'Estás al día',
        detalle: `Próxima cuota: ${formatCurrency(montoProximaCuota(c))} el ${fmtLargo(c.proximoCobro)}.${c.saldo < -0.005 ? ` Tienes ${formatCurrency(-c.saldo)} a favor.` : ''}`,
        monto: montoProximaCuota(c),
        notaMonto: 'Es tu próxima cuota. Si pagaste más meses, cámbialo.',
      };
    case 'prueba':
      return {
        tono: 'azul',
        titulo: 'Prueba gratis',
        detalle: c.dias != null
          ? `Te ${c.dias === 1 ? 'queda' : 'quedan'} ${c.dias} ${c.dias === 1 ? 'día' : 'días'}.${c.mensual > 0 ? ` Después, ${formatCurrency(c.mensual)} al mes.` : ''}`
          : 'Estás en período de prueba.',
        monto: c.montoPeriodo > 0 ? c.montoPeriodo : null,
      };
    case 'prueba_vencida':
      return {
        tono: 'rojo',
        titulo: 'Tu prueba terminó',
        detalle: `Puedes ver tus datos pero no modificarlos. Para activar la cuenta, transfiere${c.montoPeriodo > 0 ? ` ${formatCurrency(c.montoPeriodo)}` : ''} y sube el comprobante.`,
        monto: c.montoPeriodo > 0 ? c.montoPeriodo : null,
      };
    case 'suspendida':
      return { tono: 'gris', titulo: 'Cuenta suspendida', detalle: 'Escríbenos para reactivarla.', monto: null };
    default:
      return { tono: 'gris', titulo: 'Cuenta activa', detalle: 'Tu cuenta no tiene una cuota configurada.', monto: null };
  }
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button" size="icon" variant="ghost" className="h-7 w-7"
      title="Copiar" aria-label={`Copiar ${texto}`}
      onClick={() => {
        navigator.clipboard?.writeText(texto).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        }).catch(() => {});
      }}
    >
      {copiado ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export default function SuscripcionPage() {
  const { appUser } = useAuth();
  const { support } = usePlatformSettings();
  const { toast } = useToast();
  const activationWaLink = waLink(support, 'Hola, tengo una pregunta sobre mi suscripción de SellAlleS');
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const esAdmin = !!appUser?.isCompanyAdmin;
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [bancos, setBancos] = useState<CuentaBancaria[]>([]);
  const [reportes, setReportes] = useState<ReportePago[]>([]);
  const [reportando, setReportando] = useState(false);
  const [retirar, setRetirar] = useState<ReportePago | null>(null);
  const [retirando, setRetirando] = useState(false);
  const { cuenta, cargando: cargandoCuenta, recargar: recargarCuenta } = useMiCuenta(esAdmin, activeCompanyId);

  const descargar = async (pago: SubscriptionPayment) => {
    setDescargando(pago.id);
    try {
      await descargarFactura(pago);
    } catch (err: any) {
      toast({ title: 'No se pudo generar la factura', description: err?.message ?? 'Error generando el PDF.', variant: 'destructive' });
    } finally {
      setDescargando(null);
    }
  };

  const load = useCallback(async () => {
    if (!activeCompanyId) { setPayments([]); setLoading(false); return; }
    const [{ data, error }, { data: reps }] = await Promise.all([
      supabase
        .from('subscription_payments')
        .select('*')
        .eq('company_id', activeCompanyId)
        .order('paid_at', { ascending: false }),
      esAdmin
        ? supabase
            .from('subscription_payment_reports')
            .select('*')
            .eq('company_id', activeCompanyId)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (!error && data) setPayments(data.map(rowToSubscriptionPayment));
    setReportes(((reps ?? []) as any[]).map(rowToReportePago));
    setLoading(false);
  }, [activeCompanyId, esAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!esAdmin) return;
    cargarCuentasBancarias().then(setBancos).catch(() => setBancos([]));
  }, [esAdmin]);

  const alReportar = () => {
    load();
    recargarCuenta();
    avisarCambioDeMiCuenta();
  };

  const confirmarRetiro = async () => {
    if (!retirar) return;
    setRetirando(true);
    const { error } = await supabase.rpc('anular_reporte_de_pago', { p_report_id: retirar.id });
    setRetirando(false);
    if (error) {
      toast({ title: 'No se pudo retirar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Comprobante retirado' });
    setRetirar(null);
    alReportar();
  };

  const r = cuenta ? resumen(cuenta) : null;
  const tono = r ? TONO[r.tono] : TONO.gris;
  const IconoEstado = r?.tono === 'verde' ? CheckCircle2 : r?.tono === 'ambar' || r?.tono === 'azul' ? Clock : AlertTriangle;
  const sePuedeReportar = esAdmin && !!activeCompanyId && cuenta?.estado !== 'suspendida';

  return (
    <div>
      <PageHeader title="Mi Suscripción" />

      <div className="space-y-6">
        {!esAdmin && appUser?.companyStatus && (
          <Card>
            <CardContent className="flex items-center gap-2 py-4 text-sm">
              {appUser.isReadOnly
                ? <><AlertTriangle className="h-4 w-4 text-red-600" /> La prueba de la empresa terminó. El administrador puede activarla desde aquí.</>
                : appUser.companyStatus === 'trial'
                  ? <><Clock className="h-4 w-4 text-amber-600" /> La empresa está en prueba gratis.</>
                  : <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> La cuenta de la empresa está activa.</>}
            </CardContent>
          </Card>
        )}

        {esAdmin && (cargandoCuenta ? (
          <Card><CardContent className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : cuenta && r && (
          <Card className={cn('border', tono.caja)}>
            <CardHeader className="pb-2">
              <CardTitle className={cn('flex items-center gap-2 text-lg', tono.texto)}>
                <IconoEstado className={cn('h-5 w-5', tono.icono)} />
                {r.titulo}
              </CardTitle>
              <CardDescription className="text-foreground/80">{r.detalle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {cuenta.soloVentas && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-white/60 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Tu cuenta está en <strong>modo solo ventas</strong>: puedes vender, cobrar, usar la caja, cotizar y registrar
                    servicios. Inventario, usuarios, gastos y la configuración quedan en consulta hasta que te pongas al día.
                  </span>
                </div>
              )}
              {cuenta.comprobantesPorConfirmar > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-sky-300 bg-white/60 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                  <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Estamos revisando {cuenta.comprobantesPorConfirmar === 1 ? 'tu comprobante' : `tus ${cuenta.comprobantesPorConfirmar} comprobantes`} por{' '}
                    <strong>{formatCurrency(cuenta.porConfirmar)}</strong>. Cuando confirmemos que llegó, te enviamos la factura.
                  </span>
                </div>
              )}

              {cuenta.cuentas.length > 0 && (
                <div className="rounded-md border bg-background/70 p-3">
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    {cuenta.tarifaPorSucursal != null ? 'Cuota por sucursal' : 'Tu cuota'}
                  </p>
                  <ul className="divide-y text-sm">
                    {cuenta.cuentas.map((x) => (
                      <li key={x.branchId ?? 'empresa'} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{x.nombre}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(x.cuota)} {cuenta.ciclo === 'annual' ? 'al año' : 'al mes'} · desde el {fmtDate(x.desde)}
                          {x.pendientes > 0
                            ? <span className="font-medium text-red-700 dark:text-red-400"> · debe {cuotasTxt(x.pendientes)}</span>
                            : x.proximaCuota ? ` · próxima ${fmtDate(x.proximaCuota)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-2 text-xs">
                    <span>Total de cuotas: <strong>{formatCurrency(cuenta.cargado)}</strong></span>
                    <span>Pagado: <strong>{formatCurrency(cuenta.pagado)}</strong></span>
                    <span className={cn(cuenta.saldo > 0 && 'text-red-700 dark:text-red-400')}>
                      {cuenta.saldo > 0 ? 'Debes' : cuenta.saldo < 0 ? 'A favor' : 'Saldo'}: <strong>{formatCurrency(Math.abs(cuenta.saldo))}</strong>
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {sePuedeReportar && (
                  <Button onClick={() => setReportando(true)}>
                    <Paperclip className="mr-2 h-4 w-4" />
                    Reportar un pago
                  </Button>
                )}
                {activationWaLink && (
                  <Button asChild variant="outline">
                    <a href={activationWaLink} target="_blank" rel="noopener noreferrer">Preguntar por WhatsApp</a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {esAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-5 w-5 text-primary" /> Cómo pagar</CardTitle>
              <CardDescription>
                Transfiere a cualquiera de estas cuentas y luego toca <strong>Reportar un pago</strong> para subir el comprobante.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bancos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay cuentas publicadas. Escríbenos y te las pasamos.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {bancos.map((b) => (
                    <div key={b.id} className="rounded-lg border p-3">
                      <p className="font-semibold">{b.bank}</p>
                      <p className="text-xs text-muted-foreground">Cuenta de {TIPO_DE_CUENTA[b.accountType].toLowerCase()}{b.currency !== 'DOP' ? ` · ${b.currency}` : ''}</p>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="font-mono text-base">{b.accountNumber}</span>
                        <BotonCopiar texto={b.accountNumber.replace(/[^0-9A-Za-z]/g, '')} />
                      </div>
                      <p className="text-sm">{b.holderName}</p>
                      {b.holderId && <p className="text-xs text-muted-foreground">{b.holderId}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {esAdmin && reportes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comprobantes enviados</CardTitle>
              <CardDescription>
                <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                  {(['por_confirmar', 'confirmado', 'rechazado'] as const).map((e) => (
                    <span key={e} className="inline-flex items-center gap-1">
                      <Badge variant="outline" className={ESTADO_REPORTE[e].badge}>{ESTADO_REPORTE[e].label}</Badge>
                      <span className="text-xs">{ESTADO_REPORTE[e].descripcion}</span>
                    </span>
                  ))}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {reportes.map((x) => {
                const e = ESTADO_REPORTE[x.status];
                return (
                  <div key={x.id} className={cn('flex gap-3 rounded-lg border p-3', e.caja)}>
                    <ComprobanteVista reporte={x} className="h-20 w-16" />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{formatCurrency(x.confirmedAmount ?? x.amount)}</span>
                        <Badge variant="outline" className={e.badge}>{e.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Transferido el {fmtDate(x.paidAt)}{x.bankLabel ? ` a ${x.bankLabel}` : ''}{x.reference ? ` · ref. ${x.reference}` : ''}
                      </p>
                      {x.status === 'confirmado' && x.confirmedAmount != null && Math.abs(x.confirmedAmount - x.amount) > 0.005 && (
                        <p className="text-xs text-muted-foreground">Reportaste {formatCurrency(x.amount)}; llegaron {formatCurrency(x.confirmedAmount)}.</p>
                      )}
                      {x.status === 'rechazado' && x.rejectReason && (
                        <p className={cn('text-xs font-medium', e.texto)}>Motivo: {x.rejectReason}</p>
                      )}
                      {x.status === 'por_confirmar' && <p className={cn('text-xs', e.texto)}>{e.descripcion}</p>}
                      {x.status === 'confirmado' && <p className={cn('text-xs', e.texto)}>Confirmado el {fmtDate(x.reviewedAt)}. La factura está abajo.</p>}
                    </div>
                    {x.status === 'por_confirmar' && (
                      <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => setRetirar(x)}>
                        Retirar
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial de pagos y facturas</CardTitle>
            <CardDescription>
              Pagos de tu suscripción registrados por SellAlleS. Cada uno tiene su factura, que puedes descargar en PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Cargando…</p>
            ) : payments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Aún no hay pagos registrados. Cuando pagues por transferencia y lo confirmemos, aparecerá aquí.
              </p>
            ) : (
              <>
              {/* Celular: una tarjeta por pago, con la factura a la vista. En la
                  tabla quedaba en la última columna, fuera de la pantalla. */}
              <div className="space-y-3 md:hidden">
                {payments.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{formatCurrency(p.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(p.paidAt)} · {METODO_DE_PAGO[p.method] ?? p.method}{p.planName ? ` · ${p.planName}` : ''}
                        </p>
                        {(p.periodStart || p.periodEnd) && (
                          <p className="text-xs text-muted-foreground">Cubre {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</p>
                        )}
                      </div>
                      {p.invoiceNumber != null && (
                        <span className="font-mono text-xs text-muted-foreground">{codigoDeFactura(p)}</span>
                      )}
                    </div>
                    {p.invoiceNumber != null && (
                      <Button
                        variant="outline" size="sm" className="mt-3 w-full"
                        disabled={descargando !== null} onClick={() => descargar(p)}
                      >
                        {descargando === p.id
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <Download className="mr-2 h-4 w-4" />}
                        Descargar factura (PDF)
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Factura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(p.paidAt)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                        <TableCell>{METODO_DE_PAGO[p.method] ?? p.method}</TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {p.periodStart || p.periodEnd ? `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}` : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.planName || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {p.invoiceNumber != null ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{codigoDeFactura(p)}</span>
                              <Button
                                variant="outline" size="sm" className="h-8"
                                disabled={descargando !== null} onClick={() => descargar(p)}
                                title="Descargar la factura en PDF"
                              >
                                {descargando === p.id
                                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  : <Download className="mr-1.5 h-4 w-4" />}
                                PDF
                              </Button>
                            </div>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {activeCompanyId && (
        <ReportarPagoDialog
          open={reportando}
          onOpenChange={setReportando}
          companyId={activeCompanyId}
          bancos={bancos}
          montoSugerido={r?.monto ?? null}
          notaMonto={r?.notaMonto}
          onReportado={alReportar}
        />
      )}

      <AlertDialog open={!!retirar} onOpenChange={(o) => { if (!o && !retirando) setRetirar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Retirar este comprobante?</AlertDialogTitle>
            <AlertDialogDescription>
              {retirar && <>{formatCurrency(retirar.amount)} del {fmtDate(retirar.paidAt)}. </>}
              Úsalo si te equivocaste de monto o de archivo; después puedes subir el correcto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retirando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarRetiro(); }} disabled={retirando}>
              {retirando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Retirar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
