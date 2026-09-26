'use client';

// Una empresa en Cobros (/admin/cobros), pintada con el color de su grupo.

import { ChevronDown, ChevronRight, Clock, Lock, LockOpen, PlusCircle, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import { BILLING_CYCLE_LABEL, type BillingCycle } from '@/lib/subscription-pricing';
import { ESTADO_COBRO_LABEL, type CobroEmpresa, type GrupoCobro } from '@/lib/subscription-status';

export interface Plan { id: string; name: string; monthly_price: number | null; annual_price_per_month: number | null; }
export interface Sub { company_id: string; plan_id: string | null; custom_monthly_price: number | null; billing_cycle: BillingCycle | null; }
export interface UltimoPago { paidAt: string; amount: number; }

export interface Fila {
  company: Company;
  plan: Plan | undefined;
  sub: Sub | undefined;
  cobro: CobroEmpresa;
  grupo: GrupoCobro;
  ultimoPago: UltimoPago | undefined;
}

export const fmtDate = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO') : '—');
/** Para timestamptz: la fecha local del instante, no la de UTC. */
export const fmtInstante = (s?: string | null) => (s ? new Date(s).toLocaleDateString('es-DO') : '—');

const cuotas = (n: number) => `${n} ${n === 1 ? 'cuota' : 'cuotas'}`;
const enDias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

// Un color por grupo, el mismo en la tarjeta del resumen, el título de la
// sección, la franja de cada empresa y su etiqueta: rojo atrasados, ámbar por
// vencer, verde al día, azul en prueba, gris lo que no se cobra.
export const COLOR: Record<GrupoCobro, { franja: string; punto: string; fondo: string; texto: string; etiqueta: string; tarjeta: string }> = {
  atrasados: {
    franja: 'border-l-red-500',
    punto: 'bg-red-500',
    fondo: 'bg-red-50/70 dark:bg-red-950/25',
    texto: 'text-red-700 dark:text-red-400',
    etiqueta: 'bg-red-600 text-white border-transparent hover:bg-red-600',
    tarjeta: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
  },
  por_vencer: {
    franja: 'border-l-amber-500',
    punto: 'bg-amber-500',
    fondo: 'bg-amber-50/70 dark:bg-amber-950/25',
    texto: 'text-amber-700 dark:text-amber-400',
    etiqueta: 'bg-amber-500 text-white border-transparent hover:bg-amber-500',
    tarjeta: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  },
  al_dia: {
    franja: 'border-l-emerald-500',
    punto: 'bg-emerald-500',
    fondo: 'bg-emerald-50/70 dark:bg-emerald-950/25',
    texto: 'text-emerald-700 dark:text-emerald-400',
    etiqueta: 'bg-emerald-600 text-white border-transparent hover:bg-emerald-600',
    tarjeta: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  },
  prueba: {
    franja: 'border-l-sky-500',
    punto: 'bg-sky-500',
    fondo: 'bg-sky-50/70 dark:bg-sky-950/25',
    texto: 'text-sky-700 dark:text-sky-400',
    etiqueta: 'bg-sky-600 text-white border-transparent hover:bg-sky-600',
    tarjeta: 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40',
  },
  no_se_cobran: {
    franja: 'border-l-gray-400',
    punto: 'bg-gray-400',
    fondo: '',
    texto: 'text-muted-foreground',
    etiqueta: 'bg-muted text-muted-foreground border-transparent hover:bg-muted',
    tarjeta: '',
  },
};

export function detalleEstado(c: CobroEmpresa): string | null {
  if (c.dias == null) return null;
  const n = Math.abs(c.dias);
  switch (c.estado) {
    case 'atrasada':
    case 'nunca_pago':
      return `${cuotas(c.cuotasPendientes)} sin pagar · la más vieja hace ${enDias(n)}`;
    case 'prueba_vencida': return `terminó hace ${enDias(n)} · en solo lectura`;
    case 'por_vencer': return c.dias === 0 ? 'le toca pagar hoy' : `le toca pagar en ${enDias(n)}`;
    case 'prueba': return c.dias === 0 ? 'termina hoy' : `le quedan ${enDias(n)}`;
    case 'al_dia': return `próximo pago en ${enDias(n)}`;
    default: return null;
  }
}

export function FilaEmpresa({ fila, abierta, onToggle, onPagar, onSoloVentas }: {
  fila: Fila;
  abierta: boolean;
  onToggle: () => void;
  onPagar: () => void;
  /** Pone o quita el modo solo ventas (siempre a mano, con confirmación). */
  onSoloVentas: (activar: boolean) => void;
}) {
  const { company, plan, cobro, ultimoPago, grupo } = fila;
  const color = COLOR[grupo];
  const detalle = detalleEstado(cobro);
  const inactivas = (company.branches ?? []).filter((b) => !b.is_active).length;
  const debe = cobro.saldo > 0 && grupo === 'atrasados';
  const seCobra = cobro.cuentas.length > 0;

  return (
    <Card className={cn('overflow-hidden border-l-[6px]', color.franja, color.fondo)}>
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            aria-expanded={abierta}
          >
            {abierta
              ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{company.name}</span>
                <Badge variant="outline" className={color.etiqueta}>{ESTADO_COBRO_LABEL[cobro.estado]}</Badge>
                {detalle && <span className={cn('text-xs font-medium', color.texto)}>{detalle}</span>}
                {cobro.soloVentas && (
                  <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    <Lock className="mr-1 h-3 w-3" /> Solo ventas
                  </Badge>
                )}
                {cobro.sugerirSoloVentas && (
                  <Badge variant="outline" className="border-dashed border-red-400 text-red-700 dark:text-red-400">
                    Sugerido: solo ventas ({cobro.diasAtraso} días)
                  </Badge>
                )}
                {cobro.comprobantesPorConfirmar > 0 && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    <Clock className="mr-1 h-3 w-3" /> {formatCurrency(cobro.porConfirmar)} por confirmar
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {plan?.name ?? 'Sin plan'} · {BILLING_CYCLE_LABEL[cobro.ciclo]} ·{' '}
                {cobro.sucursalesActivas} {cobro.sucursalesActivas === 1 ? 'sucursal activa' : 'sucursales activas'}
                {inactivas > 0 ? ` (+${inactivas} inactiva${inactivas === 1 ? '' : 's'}, no se cobra${inactivas === 1 ? '' : 'n'})` : ''}
              </p>
            </div>
          </button>

          <div className="grid grid-cols-3 gap-3 text-sm md:w-[440px] md:shrink-0">
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">{cobro.ciclo === 'annual' ? 'Por año' : 'Por mes'}</p>
              <p className="font-semibold">{cobro.montoPeriodo > 0 ? formatCurrency(cobro.montoPeriodo) : '—'}</p>
              {cobro.tarifaPorSucursal != null && cobro.tarifaPorSucursal > 0 && cobro.sucursalesActivas > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {formatCurrency(cobro.tarifaPorSucursal)} × {cobro.sucursalesActivas}{cobro.ciclo === 'annual' ? ' × 12' : ''}
                </p>
              )}
            </div>
            {debe ? (
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Debe</p>
                <p className={cn('font-bold', color.texto)}>{formatCurrency(cobro.saldo)}</p>
                <p className="text-[11px] text-muted-foreground">desde {fmtDate(cobro.debeDesde)}</p>
              </div>
            ) : (
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Próximo cobro</p>
                <p className="font-medium">{fmtDate(cobro.proximoCobro)}</p>
                {cobro.saldo < 0 && seCobra && (
                  <p className="text-[11px] text-muted-foreground">{formatCurrency(-cobro.saldo)} a favor</p>
                )}
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Último pago</p>
              <p className="font-medium">{ultimoPago ? fmtDate(ultimoPago.paidAt) : '—'}</p>
              {ultimoPago && <p className="text-[11px] text-muted-foreground">{formatCurrency(ultimoPago.amount)}</p>}
            </div>
          </div>

          <div className="flex gap-2 md:shrink-0 md:flex-col">
            <Button size="sm" className="flex-1 md:flex-none" onClick={onPagar}>
              <PlusCircle className="mr-1.5 h-4 w-4" />
              Registrar pago
            </Button>
            {cobro.soloVentas ? (
              <Button size="sm" variant="outline" className="flex-1 md:flex-none" onClick={() => onSoloVentas(false)}>
                <LockOpen className="mr-1.5 h-4 w-4" />
                Quitar solo ventas
              </Button>
            ) : (cobro.sugerirSoloVentas || (debe && abierta)) && (
              <Button
                size="sm" variant="outline"
                className="flex-1 border-red-300 text-red-700 hover:bg-red-50 md:flex-none dark:border-red-900 dark:text-red-400"
                onClick={() => onSoloVentas(true)}
              >
                <Lock className="mr-1.5 h-4 w-4" />
                Pasar a solo ventas
              </Button>
            )}
          </div>
        </div>

        {abierta && (
          <div className="border-t bg-background/60 px-3 py-2 text-sm">
            {seCobra ? (
              <>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Cuenta por sucursal</p>
                <ul className="divide-y">
                  {cobro.cuentas.map((c) => (
                    <li key={c.branchId ?? 'empresa'} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.nombre}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        se cobra desde {fmtDate(c.desde)} · {cuotas(c.cuotas)} de {formatCurrency(c.cuota)} = {formatCurrency(c.cargado)} · próxima {fmtDate(c.proximaCuota)}
                        {c.pendientes > 0 && (
                          <span className={cn('font-medium', color.texto)}> · debe {cuotas(c.pendientes)} desde {fmtDate(c.debeDesde)}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-2 text-xs">
                  <span>Cargado: <strong>{formatCurrency(cobro.cargado)}</strong></span>
                  <span>Pagado: <strong>{formatCurrency(cobro.pagado)}</strong></span>
                  <span className={cn(cobro.saldo > 0 && color.texto)}>
                    {cobro.saldo > 0 ? 'Debe' : cobro.saldo < 0 ? 'A favor' : 'Saldo'}: <strong>{formatCurrency(Math.abs(cobro.saldo))}</strong>
                  </span>
                </div>
                {inactivas > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Las sucursales inactivas no se cobran: {(company.branches ?? []).filter((b) => !b.is_active).map((b) => b.name).join(', ')}.
                  </p>
                )}
                {cobro.soloVentas && (
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                    En solo ventas desde el {fmtInstante(cobro.soloVentasDesde)}: vende, cobra y usa la caja; lo demás queda en consulta.
                  </p>
                )}
                {cobro.tarifaPorSucursal == null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Plan a medida: {formatCurrency(cobro.mensual)}/mes acordado para toda la empresa, sin importar las sucursales.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Sucursales</p>
                <ul className="divide-y">
                  {(company.branches ?? []).map((b) => (
                    <li key={b.id} className="flex items-center gap-2 py-1.5">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className={cn('truncate', !b.is_active && 'text-muted-foreground line-through')}>{b.name}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">No se le está cobrando: {ESTADO_COBRO_LABEL[cobro.estado].toLowerCase()}.</p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
