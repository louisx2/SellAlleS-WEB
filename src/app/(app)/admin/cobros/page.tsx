'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, PlusCircle, Search, Store } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SubscriptionPaymentsDialog } from '@/components/admin/subscription-payments-dialog';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import { BILLING_CYCLE_LABEL, type BillingCycle } from '@/lib/subscription-pricing';
import {
  cobroDeEmpresa, hoyLocal, DIAS_AVISO, ESTADO_COBRO_LABEL, ESTADO_COBRO_ORDEN,
  type CobroEmpresa, type EstadoCobro,
} from '@/lib/subscription-status';

interface Plan { id: string; name: string; monthly_price: number | null; annual_price_per_month: number | null; }
interface Sub { company_id: string; plan_id: string | null; custom_monthly_price: number | null; billing_cycle: BillingCycle | null; }
interface UltimoPago { paidAt: string; amount: number; }

interface Fila {
  company: Company;
  plan: Plan | undefined;
  sub: Sub | undefined;
  cobro: CobroEmpresa;
  ultimoPago: UltimoPago | undefined;
}

const fmtDate = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('es-DO') : '—');

// Colores del estado: rojo lo que ya hay que cobrar, ámbar lo que está por
// llegar, verde lo que está bien, gris lo que no se cobra.
const ESTADO_CLASE: Record<EstadoCobro, string> = {
  vencida: 'bg-destructive text-destructive-foreground hover:bg-destructive',
  sin_registro: 'bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15',
  prueba_vencida: 'bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15',
  por_vencer: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15',
  prueba: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/15',
  al_dia: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15',
  sin_tarifa: 'bg-muted text-muted-foreground hover:bg-muted',
  suspendida: 'bg-muted text-muted-foreground hover:bg-muted',
};

function detalleEstado(c: CobroEmpresa): string | null {
  if (c.dias == null) return null;
  const n = Math.abs(c.dias);
  const dias = `${n} ${n === 1 ? 'día' : 'días'}`;
  switch (c.estado) {
    case 'vencida': return `hace ${dias} · en solo lectura`;
    case 'prueba_vencida': return `terminó hace ${dias}`;
    case 'por_vencer': return c.dias === 0 ? 'vence hoy' : `vence en ${dias}`;
    case 'prueba': return c.dias === 0 ? 'termina hoy' : `quedan ${dias}`;
    case 'al_dia': return `quedan ${dias}`;
    default: return null;
  }
}

export default function CobrosPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [ultimos, setUltimos] = useState<Record<string, UltimoPago>>({});

  const [tipo, setTipo] = useState<'real' | 'demo' | 'todas'>('real');
  // 'atrasadas' = vencidas o sin registrar; 'cobrar' = eso más las por vencer.
  const [filtro, setFiltro] = useState<EstadoCobro | 'todas' | 'cobrar' | 'atrasadas'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [pagosDe, setPagosDe] = useState<Company | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // El embed de sucursales va por su FK: con el nombre de la tabla a secas
    // PostgREST lo ve ambiguo (ver admin/empresas) y no devuelve nada.
    const [
      { data: comps, error: eComps },
      { data: pls },
      { data: ss },
      { data: pagos },
    ] = await Promise.all([
      supabase.from('companies')
        .select('*, branches!branches_company_id_fkey(id, name, location, is_active, max_users)')
        .order('name'),
      supabase.from('plans').select('id, name, monthly_price, annual_price_per_month'),
      supabase.from('subscriptions').select('company_id, plan_id, custom_monthly_price, billing_cycle'),
      supabase.from('subscription_payments').select('company_id, paid_at, amount').order('paid_at', { ascending: false }),
    ]);
    if (eComps) {
      toast({ title: 'No se pudieron cargar las empresas', description: eComps.message, variant: 'destructive' });
    }
    setCompanies((comps ?? []) as Company[]);
    setPlans(((pls ?? []) as any[]).map((p) => ({
      ...p,
      monthly_price: p.monthly_price != null ? Number(p.monthly_price) : null,
      annual_price_per_month: p.annual_price_per_month != null ? Number(p.annual_price_per_month) : null,
    })));
    const mapaSubs: Record<string, Sub> = {};
    ((ss ?? []) as any[]).forEach((s) => {
      mapaSubs[s.company_id] = {
        ...s,
        custom_monthly_price: s.custom_monthly_price != null ? Number(s.custom_monthly_price) : null,
      };
    });
    setSubs(mapaSubs);
    // Vienen del más reciente al más viejo: el primero de cada empresa es el último pago.
    const mapaUltimos: Record<string, UltimoPago> = {};
    ((pagos ?? []) as any[]).forEach((p) => {
      if (!mapaUltimos[p.company_id]) mapaUltimos[p.company_id] = { paidAt: p.paid_at, amount: Number(p.amount) };
    });
    setUltimos(mapaUltimos);
    setLoading(false);
  }, [toast]);

  useEffect(() => { if (appUser?.isSuperAdmin) load(); }, [appUser?.isSuperAdmin, load]);

  // Tras registrar un pago se recargan las empresas: el diálogo abierto pasa a
  // la versión nueva, para que su "pagado hasta" no se quede en el viejo.
  useEffect(() => {
    setPagosDe((actual) => (actual ? companies.find((c) => c.id === actual.id) ?? actual : actual));
  }, [companies]);

  const hoy = hoyLocal();
  const filas: Fila[] = useMemo(() => companies
    .filter((c) => (tipo === 'real' ? !c.is_demo : tipo === 'demo' ? !!c.is_demo : true))
    .map((company) => {
      const sub = subs[company.id];
      const plan = plans.find((p) => p.id === sub?.plan_id);
      return { company, plan, sub, cobro: cobroDeEmpresa(company, plan, sub, hoy), ultimoPago: ultimos[company.id] };
    })
    .sort((a, b) =>
      ESTADO_COBRO_ORDEN.indexOf(a.cobro.estado) - ESTADO_COBRO_ORDEN.indexOf(b.cobro.estado)
      || (a.cobro.dias ?? 0) - (b.cobro.dias ?? 0)
      || a.company.name.localeCompare(b.company.name, 'es')),
  [companies, subs, plans, ultimos, tipo, hoy]);

  const atrasada = (f: Fila) => f.cobro.estado === 'vencida' || f.cobro.estado === 'sin_registro';
  const porCobrar = (f: Fila) => atrasada(f) || f.cobro.estado === 'por_vencer';

  const resumen = useMemo(() => {
    const cuenta = (e: EstadoCobro[]) => filas.filter((f) => e.includes(f.cobro.estado));
    const cobrar = filas.filter(porCobrar);
    return {
      alDia: cuenta(['al_dia']).length,
      porVencer: cuenta(['por_vencer']).length,
      atrasadas: cuenta(['vencida', 'sin_registro']).length,
      prueba: cuenta(['prueba', 'prueba_vencida']).length,
      montoPorCobrar: cobrar.reduce((acc, f) => acc + f.cobro.montoPeriodo, 0),
      mrrAlDia: cuenta(['al_dia', 'por_vencer']).reduce((acc, f) => acc + f.cobro.mensual, 0),
    };
  }, [filas]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (filtro === 'cobrar') { if (!porCobrar(f)) return false; }
      else if (filtro === 'atrasadas') { if (!atrasada(f)) return false; }
      else if (filtro !== 'todas' && f.cobro.estado !== filtro) return false;
      if (!q) return true;
      return f.company.name.toLowerCase().includes(q)
        || (f.company.branches ?? []).some((b) => b.name.toLowerCase().includes(q));
    });
  }, [filas, filtro, busqueda]);

  const toggle = (id: string) => setAbiertas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!appUser?.isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Cobros" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No tienes permiso para ver esta sección.
        </CardContent></Card>
      </div>
    );
  }

  const tarjetas: { label: string; valor: string; nota: string; filtro: typeof filtro; clase?: string }[] = [
    { label: 'Al día', valor: String(resumen.alDia), nota: `${formatCurrency(resumen.mrrAlDia)}/mes cubiertos`, filtro: 'al_dia', clase: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Por vencer', valor: String(resumen.porVencer), nota: `en los próximos ${DIAS_AVISO} días`, filtro: 'por_vencer', clase: 'text-amber-600 dark:text-amber-400' },
    { label: 'Vencidas o sin registrar', valor: String(resumen.atrasadas), nota: 'activas sin pago al día', filtro: 'atrasadas', clase: 'text-destructive' },
    { label: 'Por cobrar', valor: formatCurrency(resumen.montoPorCobrar), nota: 'vencidas, sin registrar y por vencer: un período de cada una', filtro: 'cobrar' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Cobros" />
      <p className="-mt-4 mb-6 text-sm text-muted-foreground">
        Quién está al día con SellAlleS. Se cobra por sucursal activa: el monto es la tarifa del plan por cada una.
      </p>

      <div className="mb-6 grid gap-3 grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <button key={t.label} type="button" onClick={() => setFiltro(t.filtro)} className="text-left">
            <Card className={cn('h-full transition-colors hover:bg-accent/50', filtro === t.filtro && 'ring-2 ring-primary')}>
              <CardHeader className="pb-1 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">{t.label}</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className={cn('text-2xl font-bold', t.clase)}>{t.valor}</div>
                <p className="text-xs text-muted-foreground">{t.nota}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar empresa o sucursal" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos los estados</SelectItem>
            <SelectItem value="cobrar">Hay que cobrar</SelectItem>
            <SelectItem value="atrasadas">Vencidas o sin registrar</SelectItem>
            {ESTADO_COBRO_ORDEN.map((e) => (
              <SelectItem key={e} value={e}>{ESTADO_COBRO_LABEL[e]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
          <SelectTrigger className="md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="real">Empresas reales</SelectItem>
            <SelectItem value="demo">Empresas demo</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : visibles.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Ninguna empresa con ese filtro.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {visibles.map((f) => {
            const { company, plan, cobro, ultimoPago } = f;
            const abierta = abiertas.has(company.id);
            const detalle = detalleEstado(cobro);
            const inactivas = (company.branches ?? []).filter((b) => !b.is_active).length;
            return (
              <Card key={company.id}>
                <CardContent className="p-0">
                  <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
                    <button
                      type="button"
                      onClick={() => toggle(company.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      aria-expanded={abierta}
                    >
                      {abierta
                        ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{company.name}</span>
                          <Badge variant="outline" className={ESTADO_CLASE[cobro.estado]}>{ESTADO_COBRO_LABEL[cobro.estado]}</Badge>
                          {detalle && <span className="text-xs text-muted-foreground">{detalle}</span>}
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
                        <p className={cn('font-medium', cobro.estado === 'vencida' && 'text-destructive')}>{fmtDate(company.paid_until)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase text-muted-foreground">Último pago</p>
                        <p className="font-medium">{ultimoPago ? fmtDate(ultimoPago.paidAt) : '—'}</p>
                        {ultimoPago && <p className="text-[11px] text-muted-foreground">{formatCurrency(ultimoPago.amount)}</p>}
                      </div>
                    </div>

                    <Button size="sm" className="md:shrink-0" onClick={() => setPagosDe(company)}>
                      <PlusCircle className="mr-1.5 h-4 w-4" />
                      Registrar pago
                    </Button>
                  </div>

                  {abierta && (
                    <div className="border-t px-3 py-2 text-sm">
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
          })}
        </div>
      )}

      <SubscriptionPaymentsDialog
        company={pagosDe}
        defaultPlanName={pagosDe ? plans.find((p) => p.id === subs[pagosDe.id]?.plan_id)?.name : undefined}
        planRates={pagosDe ? {
          monthlyPrice: plans.find((p) => p.id === subs[pagosDe.id]?.plan_id)?.monthly_price ?? null,
          annualPricePerMonth: plans.find((p) => p.id === subs[pagosDe.id]?.plan_id)?.annual_price_per_month ?? null,
          customMonthlyPrice: subs[pagosDe.id]?.custom_monthly_price ?? null,
          activeBranches: (pagosDe.branches ?? []).filter((b) => b.is_active).length,
        } : undefined}
        onOpenChange={(o) => { if (!o) setPagosDe(null); }}
        onRecorded={load}
      />
    </div>
  );
}
