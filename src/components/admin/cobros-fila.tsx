'use client';

// Una empresa en Cobros (/admin/cobros), pintada con el color de su grupo.

import { ChevronDown, ChevronRight, PlusCircle, Store } from 'lucide-react';
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

const fmtDate = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO') : '—');

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
  const dias = `${n} ${n === 1 ? 'día' : 'días'}`;
  switch (c.estado) {
    case 'vencida': return `venció hace ${dias} · en solo lectura`;
    case 'prueba_vencida': return `terminó hace ${dias} · en solo lectura`;
    case 'por_vencer': return c.dias === 0 ? 'vence hoy' : `vence en ${dias}`;
    case 'prueba': return c.dias === 0 ? 'termina hoy' : `le quedan ${dias}`;
    case 'al_dia': return `le quedan ${dias}`;
    default: return null;
  }
}

export function FilaEmpresa({ fila, abierta, onToggle, onPagar }: {
  fila: Fila;
  abierta: boolean;
  onToggle: () => void;
  onPagar: () => void;
}) {
  const { company, plan, cobro, ultimoPago, grupo } = fila;
  const color = COLOR[grupo];
  const detalle = detalleEstado(cobro);
  const inactivas = (company.branches ?? []).filter((b) => !b.is_active).length;

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
              </div>
              <p className="text-xs text-muted-foreground">
                {plan?.name ?? 'Sin plan'} · {BILLING_CYCLE_LABEL[cobro.ciclo]} ·{' '}
                {cobro.sucursalesActivas} {cobro.sucursalesActivas === 1 ? 'sucursal activa' : 'sucursales activas'}
                {inactivas > 0 ? ` (+${inactivas} inactiva${inactivas === 1 ? '' : 's'}, no se cobra${inactivas === 1 ? '' : 'n'})` : ''}
              </p>
            </div>
          </button>

          <div className="grid grid-cols-3 gap-3 text-sm md:w-[420px] md:shrink-0">
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">{cobro.ciclo === 'annual' ? 'Por año' : 'Por mes'}</p>
              <p className="font-semibold">{cobro.montoPeriodo > 0 ? formatCurrency(cobro.montoPeriodo) : '—'}</p>
              {cobro.tarifaPorSucursal != null && cobro.tarifaPorSucursal > 0 && cobro.sucursalesActivas > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {formatCurrency(cobro.tarifaPorSucursal)} × {cobro.sucursalesActivas}{cobro.ciclo === 'annual' ? ' × 12' : ''}
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Pagado hasta</p>
              <p className={cn('font-medium', grupo === 'atrasados' && color.texto)}>{fmtDate(company.paid_until)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Último pago</p>
              <p className="font-medium">{ultimoPago ? fmtDate(ultimoPago.paidAt) : '—'}</p>
              {ultimoPago && <p className="text-[11px] text-muted-foreground">{formatCurrency(ultimoPago.amount)}</p>}
            </div>
          </div>

          <Button size="sm" className="md:shrink-0" onClick={onPagar}>
            <PlusCircle className="mr-1.5 h-4 w-4" />
            Registrar pago
          </Button>
        </div>

        {abierta && (
          <div className="border-t bg-background/60 px-3 py-2 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Sucursales</p>
            {(company.branches ?? []).length === 0 ? (
              <p className="text-muted-foreground">Sin sucursales.</p>
            ) : (
              <ul className="divide-y">
                {[...(company.branches ?? [])]
                  .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'es'))
                  .map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className={cn('truncate', !b.is_active && 'text-muted-foreground line-through')}>{b.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {!b.is_active
                          ? 'Inactiva · no se cobra'
                          : cobro.tarifaPorSucursal != null && cobro.tarifaPorSucursal > 0
                            ? `${formatCurrency(cobro.tarifaPorSucursal)}/mes`
                            : 'Activa'}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {cobro.tarifaPorSucursal == null && cobro.mensual > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Plan a medida: {formatCurrency(cobro.mensual)}/mes acordado para toda la empresa, sin importar las sucursales.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
