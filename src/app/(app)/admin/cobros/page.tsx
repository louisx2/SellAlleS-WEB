'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SubscriptionPaymentsDialog } from '@/components/admin/subscription-payments-dialog';
import { COLOR, FilaEmpresa, type Fila, type Plan, type Sub, type UltimoPago } from '@/components/admin/cobros-fila';
import {
  BandejaPorConfirmar, ConfirmarComprobanteDialog, RechazarComprobanteDialog,
} from '@/components/admin/comprobantes-por-confirmar';
import { avisarCambioDeComprobantes } from '@/hooks/use-comprobantes-pendientes';
import { useAuth } from '@/context/auth-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  cuentaDesdeJson, DIAS_AVISO, ESTADO_COBRO_ORDEN,
  GRUPO_DE_ESTADO, GRUPOS_COBRO, type CobroEmpresa, type GrupoCobro,
} from '@/lib/subscription-status';
import { rowToReportePago, type ReportePago } from '@/lib/payment-reports';

export default function CobrosPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [ultimos, setUltimos] = useState<Record<string, UltimoPago>>({});
  // La cuenta de cada empresa la calcula la base: la misma que ven el banner
  // del cliente, los correos y el resumen de la noche.
  const [cuentas, setCuentas] = useState<Record<string, CobroEmpresa>>({});
  const [reportes, setReportes] = useState<ReportePago[]>([]);
  const [confirmando, setConfirmando] = useState<ReportePago | null>(null);
  const [rechazando, setRechazando] = useState<ReportePago | null>(null);
  const [soloVentas, setSoloVentas] = useState<{ company: Company; activar: boolean } | null>(null);
  const [cambiandoSoloVentas, setCambiandoSoloVentas] = useState(false);

  const [tipo, setTipo] = useState<'real' | 'demo' | 'todas'>('real');
  const [grupo, setGrupo] = useState<GrupoCobro | 'todos'>('todos');
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
      { data: ctas, error: eCtas },
      { data: reps },
    ] = await Promise.all([
      supabase.from('companies')
        .select('*, branches!branches_company_id_fkey(id, name, location, is_active, max_users, created_at)')
        .order('name'),
      supabase.from('plans').select('id, name, monthly_price, annual_price_per_month'),
      supabase.from('subscriptions').select('company_id, plan_id, custom_monthly_price, billing_cycle'),
      supabase.from('subscription_payments').select('company_id, paid_at, amount').order('paid_at', { ascending: false }),
      supabase.rpc('cuentas_de_suscripcion'),
      // Los pendientes y los recientes: con los recientes se avisa si una
      // transferencia parece repetida.
      supabase.from('subscription_payment_reports').select('*').order('created_at', { ascending: false }).limit(500),
    ]);
    if (eComps) {
      toast({ title: 'No se pudieron cargar las empresas', description: eComps.message, variant: 'destructive' });
    }
    if (eCtas) {
      toast({ title: 'No se pudieron calcular las cuentas', description: eCtas.message, variant: 'destructive' });
    }
    const mapaCuentas: Record<string, CobroEmpresa> = {};
    ((ctas ?? []) as { company_id: string; cuenta: unknown }[]).forEach((c) => {
      if (c.cuenta) mapaCuentas[c.company_id] = cuentaDesdeJson(c.cuenta);
    });
    setCuentas(mapaCuentas);
    setReportes(((reps ?? []) as any[]).map(rowToReportePago));
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
    // Vienen del más reciente al más viejo: el primero de cada empresa es el
    // último pago.
    const mapaUltimos: Record<string, UltimoPago> = {};
    ((pagos ?? []) as any[]).forEach((p) => {
      if (!mapaUltimos[p.company_id]) mapaUltimos[p.company_id] = { paidAt: p.paid_at, amount: Number(p.amount) };
    });
    setUltimos(mapaUltimos);
    setLoading(false);
    avisarCambioDeComprobantes();
  }, [toast]);

  useEffect(() => { if (appUser?.isSuperAdmin) load(); }, [appUser?.isSuperAdmin, load]);

  // Tras registrar un pago se recargan las empresas: el diálogo abierto pasa a
  // la versión nueva, para que su "pagado hasta" no se quede en el viejo.
  useEffect(() => {
    setPagosDe((actual) => (actual ? companies.find((c) => c.id === actual.id) ?? actual : actual));
  }, [companies]);

  const filas: Fila[] = useMemo(() => companies
    .filter((c) => (tipo === 'real' ? !c.is_demo : tipo === 'demo' ? !!c.is_demo : true))
    .filter((c) => cuentas[c.id])
    .map((company) => {
      const sub = subs[company.id];
      const plan = plans.find((p) => p.id === sub?.plan_id);
      const cobro = cuentas[company.id];
      return { company, plan, sub, cobro, grupo: GRUPO_DE_ESTADO[cobro.estado], ultimoPago: ultimos[company.id] };
    })
    .sort((a, b) =>
      ESTADO_COBRO_ORDEN.indexOf(a.cobro.estado) - ESTADO_COBRO_ORDEN.indexOf(b.cobro.estado)
      || (a.cobro.dias ?? 0) - (b.cobro.dias ?? 0)
      || a.company.name.localeCompare(b.company.name, 'es')),
  [companies, subs, plans, ultimos, cuentas, tipo]);

  const empresasPorId = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const pendientes = useMemo(
    () => reportes.filter((r) => r.status === 'por_confirmar').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [reportes],
  );

  const aplicarSoloVentas = async () => {
    if (!soloVentas) return;
    setCambiandoSoloVentas(true);
    const { error } = await supabase.rpc('poner_solo_ventas', {
      p_company_id: soloVentas.company.id, p_activo: soloVentas.activar,
    });
    setCambiandoSoloVentas(false);
    if (error) {
      toast({ title: 'No se pudo cambiar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: soloVentas.activar ? 'Pasada a solo ventas' : 'Solo ventas quitado',
      description: soloVentas.activar
        ? `${soloVentas.company.name} sigue vendiendo y cobrando; lo demás queda en consulta. Lo ve al recargar la app.`
        : `${soloVentas.company.name} vuelve a operar normal. Lo ve al recargar la app.`,
    });
    setSoloVentas(null);
    load();
  };

  const porGrupo = useMemo(() => {
    const m = {} as Record<GrupoCobro, Fila[]>;
    GRUPOS_COBRO.forEach((g) => { m[g.key] = []; });
    filas.forEach((f) => m[f.grupo].push(f));
    return m;
  }, [filas]);

  const notaResumen = (g: GrupoCobro): string => {
    const fs = porGrupo[g];
    const suma = (sel: (f: Fila) => number) => fs.reduce((acc, f) => acc + sel(f), 0);
    switch (g) {
      case 'atrasados': return fs.length ? `deben ${formatCurrency(suma((f) => Math.max(f.cobro.saldo, 0)))}` : 'nadie atrasado';
      case 'por_vencer': return `les toca pagar en ${DIAS_AVISO} días o menos`;
      case 'al_dia': return fs.length ? `${formatCurrency(suma((f) => f.cobro.mensual))}/mes al corriente` : 'ninguna todavía';
      case 'prueba': {
        const vencidas = fs.filter((f) => f.cobro.estado === 'prueba_vencida').length;
        return vencidas ? `${vencidas} con la prueba terminada` : 'todas dentro del plazo';
      }
      default: return 'sin precio o suspendidas';
    }
  };

  const coincide = useCallback((f: Fila) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return f.company.name.toLowerCase().includes(q)
      || (f.company.branches ?? []).some((b) => b.name.toLowerCase().includes(q));
  }, [busqueda]);

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

  const gruposVisibles = GRUPOS_COBRO.filter((g) => grupo === 'todos' || g.key === grupo);
  const hayAlguna = gruposVisibles.some((g) => porGrupo[g.key].some(coincide));

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Cobros" />
      <p className="-mt-4 mb-6 text-sm text-muted-foreground">
        Quién está al día con SellAlleS. Cada sucursal activa paga su cuota por adelantado cada mes desde el día en
        que se creó, aunque después se haya movido de empresa; a eso se le resta todo lo pagado. Atrasarse no bloquea
        a nadie solo: pasar una empresa a solo ventas lo decides tú.
      </p>

      {/* Resumen: una tarjeta por color. Tocarla deja solo ese grupo; tocarla
          otra vez vuelve a mostrar todos. */}
      <div className="mb-6 grid gap-3 grid-cols-2 lg:grid-cols-4">
        {GRUPOS_COBRO.filter((g) => g.key !== 'no_se_cobran').map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGrupo((actual) => (actual === g.key ? 'todos' : g.key))}
            className={cn(
              'rounded-lg border p-4 text-left transition-shadow hover:shadow-md',
              COLOR[g.key].tarjeta,
              grupo === g.key && 'ring-2 ring-offset-2 ring-primary',
            )}
          >
            <p className={cn('text-xs font-semibold uppercase tracking-wide', COLOR[g.key].texto)}>{g.label}</p>
            <p className={cn('text-3xl font-bold', COLOR[g.key].texto)}>{porGrupo[g.key].length}</p>
            <p className="text-xs text-muted-foreground">{notaResumen(g.key)}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar empresa o sucursal" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <Select value={grupo} onValueChange={(v) => setGrupo(v as typeof grupo)}>
          <SelectTrigger className="md:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {GRUPOS_COBRO.map((g) => (
              <SelectItem key={g.key} value={g.key}>{g.label} ({porGrupo[g.key].length})</SelectItem>
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
      ) : !hayAlguna ? (
        <>
          <BandejaPorConfirmar
            pendientes={pendientes} todos={reportes} empresas={empresasPorId} cuentas={cuentas}
            onConfirmar={setConfirmando} onRechazar={setRechazando}
          />
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            Ninguna empresa con ese filtro.
          </CardContent></Card>
        </>
      ) : (
        <div className="space-y-8">
          <BandejaPorConfirmar
            pendientes={pendientes} todos={reportes} empresas={empresasPorId} cuentas={cuentas}
            onConfirmar={setConfirmando} onRechazar={setRechazando}
          />
          {gruposVisibles.map((g) => {
            const filasGrupo = porGrupo[g.key].filter(coincide);
            if (filasGrupo.length === 0) return null;
            const color = COLOR[g.key];
            return (
              <section key={g.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn('h-3 w-3 shrink-0 rounded-full self-center', color.punto)} />
                  <h2 className={cn('text-lg font-semibold', color.texto)}>{g.label}</h2>
                  <span className="text-sm text-muted-foreground">({filasGrupo.length})</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">· {g.descripcion}</span>
                </div>
                <div className="space-y-2">
                  {filasGrupo.map((f) => (
                    <FilaEmpresa
                      key={f.company.id}
                      fila={f}
                      abierta={abiertas.has(f.company.id)}
                      onToggle={() => toggle(f.company.id)}
                      onPagar={() => setPagosDe(f.company)}
                      onSoloVentas={(activar) => setSoloVentas({ company: f.company, activar })}
                    />
                  ))}
                </div>
              </section>
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
        pendiente={pagosDe ? filas.find((f) => f.company.id === pagosDe.id)?.cobro.pagarPendiente ?? null : null}
        onOpenChange={(o) => { if (!o) setPagosDe(null); }}
        onRecorded={load}
      />

      <ConfirmarComprobanteDialog
        reporte={confirmando}
        company={confirmando ? empresasPorId[confirmando.companyId] : undefined}
        cuenta={confirmando ? cuentas[confirmando.companyId] : undefined}
        onClose={() => setConfirmando(null)}
        onDone={load}
      />
      <RechazarComprobanteDialog
        reporte={rechazando}
        company={rechazando ? empresasPorId[rechazando.companyId] : undefined}
        onClose={() => setRechazando(null)}
        onDone={load}
      />

      <AlertDialog open={!!soloVentas} onOpenChange={(o) => { if (!o && !cambiandoSoloVentas) setSoloVentas(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {soloVentas?.activar ? `¿Pasar ${soloVentas.company.name} a solo ventas?` : `¿Quitarle el modo solo ventas a ${soloVentas?.company.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {soloVentas?.activar
                ? 'Podrán seguir vendiendo, cobrando, usando la caja y reportando su pago. Inventario, clientes, usuarios, gastos y lo demás quedan en consulta hasta que se lo quites. Ven un aviso con lo que deben.'
                : 'Vuelven a operar normal en cuanto recarguen la app.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {soloVentas?.activar && cuentas[soloVentas.company.id] && (
            <p className="text-sm">
              Debe <strong>{formatCurrency(Math.max(cuentas[soloVentas.company.id].saldo, 0))}</strong>
              {' '}con {cuentas[soloVentas.company.id].diasAtraso} días de atraso.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cambiandoSoloVentas}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); aplicarSoloVentas(); }}
              disabled={cambiandoSoloVentas}
              className={soloVentas?.activar ? 'bg-red-600 hover:bg-red-700' : undefined}
            >
              {cambiandoSoloVentas && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {soloVentas?.activar ? 'Pasar a solo ventas' : 'Quitar solo ventas'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
