'use client';

// Empresas del super admin (/admin/empresas), agrupadas por su estado y con el
// mismo estilo que Cobros: un color por grupo en la tarjeta del resumen, el
// título de la sección y la franja de cada empresa.
//
// Grupos (lib/grupos-empresa.ts): prueba vencida, en prueba, activas y
// suspendidas. En las activas, una segunda etiqueta dice cómo van con sus
// cuotas (la misma cuenta que Cobros). Los dueños con varias empresas siguen
// viendo la tabla de siempre (companies-data-table).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronRight, Clock, Loader2, Lock, LogIn, PlusCircle, Power, Search, Store, Users, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COLOR, detalleEstado, fmtDate, fmtInstante } from '@/components/admin/cobros-fila';
import { ECF_ETIQUETA, getSectorLabel, type EcfDeEmpresa } from '@/components/admin/companies-data-table';
import { MenuEmpresa, MenuSucursal, type AccionesEmpresa } from '@/components/admin/empresa-menus';
import { ECF_AMBIENTE_NOMBRE } from '@/lib/ecf';
import { compararEnGrupo, grupoDeEmpresa, GRUPOS_EMPRESA, type GrupoEmpresa } from '@/lib/grupos-empresa';
import { esMotivoSuspension, MOTIVO_SUSPENSION_INFO } from '@/lib/suspension';
import {
  diasEntre, ESTADO_COBRO_LABEL, ESTADO_COBRO_ORDEN, fechaLocal, GRUPO_DE_ESTADO, hoyLocal, type CobroEmpresa,
} from '@/lib/subscription-status';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';

type Colores = (typeof COLOR)[keyof typeof COLOR];

// Los colores de Cobros: ámbar lo que pide atención, azul la prueba, verde lo
// que está bien. Las suspendidas en gris, con la etiqueta en rojo.
const COLOR_GRUPO: Record<GrupoEmpresa, Colores> = {
  prueba_vencida: COLOR.por_vencer,
  prueba: COLOR.prueba,
  activas: COLOR.al_dia,
  suspendidas: {
    ...COLOR.no_se_cobran,
    fondo: 'bg-muted/40',
    etiqueta: 'bg-red-600 text-white border-transparent hover:bg-red-600',
    tarjeta: 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40',
  },
};

const ETIQUETA_GRUPO: Record<GrupoEmpresa, string> = {
  prueba_vencida: 'Prueba vencida',
  prueba: 'En prueba',
  activas: 'Activa',
  suspendidas: 'Suspendida',
};

const enDias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Ventas de los últimos 30 días de una empresa. */
export interface ActividadEmpresa { ventas: number; ultima: string | null }

interface Props extends AccionesEmpresa {
  companies: Company[];
  loading: boolean;
  /** Cuenta de cada empresa (cuentas_de_suscripcion). Puede faltar alguna. */
  cuentas: Record<string, CobroEmpresa>;
  /** "Pro · Mensual", "A medida", "Sin plan"... */
  planDe: (companyId: string) => string;
  usuariosPorEmpresa: Record<string, number>;
  actividad: Record<string, ActividadEmpresa>;
  branchUserCounts?: Record<string, number>;
  ecfPorEmpresa?: Record<string, EcfDeEmpresa>;
  onActivar: (c: Company) => void;
}

interface Fila { company: Company; grupo: GrupoEmpresa; cobro: CobroEmpresa | undefined }

export function EmpresasPanel(props: Props) {
  const { companies, loading, cuentas } = props;
  const [grupo, setGrupo] = useState<GrupoEmpresa | 'todos'>('todos');
  const [tipo, setTipo] = useState<'real' | 'demo' | 'todas'>('real');
  const [busqueda, setBusqueda] = useState('');
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const filas: Fila[] = useMemo(() => {
    const ahora = Date.now();
    return companies
      .filter((c) => (tipo === 'real' ? !c.is_demo : tipo === 'demo' ? !!c.is_demo : true))
      .map((company) => ({
        company,
        grupo: grupoDeEmpresa({ status: company.status, trialEndsAt: company.trial_ends_at }, ahora),
        cobro: cuentas[company.id],
      }));
  }, [companies, cuentas, tipo]);

  const porGrupo = useMemo(() => {
    const m = {} as Record<GrupoEmpresa, Fila[]>;
    GRUPOS_EMPRESA.forEach((g) => { m[g.key] = []; });
    filas.forEach((f) => m[f.grupo].push(f));
    GRUPOS_EMPRESA.forEach((g) => {
      m[g.key].sort((a, b) => compararEnGrupo(
        g.key,
        {
          nombre: a.company.name, trialEndsAt: a.company.trial_ends_at, suspendedAt: a.company.suspended_at,
          ordenCobro: a.cobro ? ESTADO_COBRO_ORDEN.indexOf(a.cobro.estado) : undefined,
        },
        {
          nombre: b.company.name, trialEndsAt: b.company.trial_ends_at, suspendedAt: b.company.suspended_at,
          ordenCobro: b.cobro ? ESTADO_COBRO_ORDEN.indexOf(b.cobro.estado) : undefined,
        },
      ));
    });
    return m;
  }, [filas]);

  const notaResumen = (g: GrupoEmpresa): string => {
    const fs = porGrupo[g];
    switch (g) {
      case 'prueba_vencida': {
        const vendiendo = fs.filter((f) => (props.actividad[f.company.id]?.ventas ?? 0) > 0).length;
        if (!fs.length) return 'ninguna';
        if (!vendiendo) return 'ninguna sigue facturando';
        return vendiendo === 1 ? '1 sigue facturando' : `${vendiendo} siguen facturando`;
      }
      case 'prueba': {
        const pronto = fs.filter((f) => f.cobro?.dias != null && f.cobro.dias <= 7).length;
        if (!pronto) return 'ninguna termina esta semana';
        return pronto === 1 ? '1 termina en 7 días o menos' : `${pronto} terminan en 7 días o menos`;
      }
      case 'activas': {
        const mensual = fs.reduce((acc, f) => acc + (f.cobro?.mensual ?? 0), 0);
        const deben = fs.filter((f) => f.cobro && GRUPO_DE_ESTADO[f.cobro.estado] === 'atrasados').length;
        return `${formatCurrency(mensual)}/mes${deben ? ` · ${deben} atrasada${deben === 1 ? '' : 's'}` : ''}`;
      }
      default: return 'no pueden operar';
    }
  };

  const coincide = (f: Fila) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    const c = f.company;
    return c.name.toLowerCase().includes(q)
      || (c.rnc ?? '').toLowerCase().includes(q)
      || (c.phone ?? '').toLowerCase().includes(q)
      || getSectorLabel(c.business_type).toLowerCase().includes(q)
      || props.planDe(c.id).toLowerCase().includes(q)
      || (c.branches ?? []).some((b) => b.name.toLowerCase().includes(q));
  };

  const toggle = (id: string) => setAbiertas((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const gruposVisibles = GRUPOS_EMPRESA.filter((g) => grupo === 'todos' || g.key === grupo);
  const hayAlguna = gruposVisibles.some((g) => porGrupo[g.key].some(coincide));

  return (
    <div>
      {/* Resumen: una tarjeta por grupo. Tocarla deja solo ese grupo; tocarla
          otra vez vuelve a mostrar todos. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {GRUPOS_EMPRESA.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGrupo((actual) => (actual === g.key ? 'todos' : g.key))}
            className={cn(
              'rounded-lg border p-4 text-left transition-shadow hover:shadow-md',
              COLOR_GRUPO[g.key].tarjeta,
              grupo === g.key && 'ring-2 ring-primary ring-offset-2',
            )}
          >
            <p className={cn('text-xs font-semibold uppercase tracking-wide', COLOR_GRUPO[g.key].texto)}>{g.label}</p>
            <p className={cn('text-3xl font-bold', COLOR_GRUPO[g.key].texto)}>{loading ? '—' : porGrupo[g.key].length}</p>
            <p className="text-xs text-muted-foreground">{loading ? ' ' : notaResumen(g.key)}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8" placeholder="Buscar empresa, RNC, teléfono, sector, plan o sucursal"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={grupo} onValueChange={(v) => setGrupo(v as typeof grupo)}>
          <SelectTrigger className="md:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            {GRUPOS_EMPRESA.map((g) => (
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
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Ninguna empresa con ese filtro.
        </CardContent></Card>
      ) : (
        <div className="space-y-8">
          {gruposVisibles.map((g) => {
            const filasGrupo = porGrupo[g.key].filter(coincide);
            if (filasGrupo.length === 0) return null;
            const color = COLOR_GRUPO[g.key];
            return (
              <section key={g.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn('h-3 w-3 shrink-0 self-center rounded-full', color.punto)} />
                  <h2 className={cn('text-lg font-semibold', color.texto)}>{g.label}</h2>
                  <span className="text-sm text-muted-foreground">({filasGrupo.length})</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">· {g.descripcion}</span>
                </div>
                <div className="space-y-2">
                  {filasGrupo.map((f) => (
                    <FilaEmpresaPanel
                      key={f.company.id}
                      fila={f}
                      abierta={abiertas.has(f.company.id)}
                      onToggle={() => toggle(f.company.id)}
                      {...props}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dato({ titulo, children, nota, className }: {
  titulo: string; children: React.ReactNode; nota?: React.ReactNode; className?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase text-muted-foreground">{titulo}</p>
      <p className={cn('truncate font-medium', className)}>{children}</p>
      {nota && <p className="truncate text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  );
}

function FilaEmpresaPanel({ fila, abierta, onToggle, ...props }: Props & {
  fila: Fila; abierta: boolean; onToggle: () => void;
}) {
  const { company: c, grupo, cobro } = fila;
  const color = COLOR_GRUPO[grupo];
  const hoy = hoyLocal();
  const activas = (c.branches ?? []).filter((b) => b.is_active).length;
  const inactivas = (c.branches ?? []).length - activas;
  const usuarios = props.usuariosPorEmpresa[c.id] ?? 0;
  const act = props.actividad[c.id];
  const ecf = props.ecfPorEmpresa?.[c.id];
  const alta = fechaLocal(c.created_at);
  const finPrueba = c.trial_ends_at ? fechaLocal(c.trial_ends_at) : null;
  const especialHasta = cobro?.cuentas.find((x) => x.precioEspecial && x.precioEspecialHasta)?.precioEspecialHasta ?? null;

  // Lo que se dice junto a la etiqueta del estado.
  let detalle: string | null = null;
  if (grupo === 'prueba_vencida' && finPrueba) {
    detalle = `terminó hace ${enDias(Math.max(diasEntre(finPrueba, hoy), 1))} · solo facturación`;
  } else if (grupo === 'prueba') {
    detalle = finPrueba
      ? (diasEntre(hoy, finPrueba) <= 0 ? 'termina hoy' : `le quedan ${enDias(diasEntre(hoy, finPrueba))}`)
      : 'sin fecha de fin';
  } else if (grupo === 'suspendidas') {
    detalle = `${esMotivoSuspension(c.suspension_reason) ? MOTIVO_SUSPENSION_INFO[c.suspension_reason].nombre : 'Sin motivo'}`
      + (c.suspended_at ? ` · desde ${fmtInstante(c.suspended_at)}` : '');
  }
  const colorCobro = cobro ? COLOR[GRUPO_DE_ESTADO[cobro.estado]] : null;

  return (
    <Card className={cn('overflow-hidden border-l-[6px]', color.franja, color.fondo)}>
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 p-3 xl:flex-row xl:items-center">
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
                <span className="font-semibold">{c.name}</span>
                {c.is_demo && (
                  <Badge variant="outline" className="h-5 border-amber-500/20 bg-amber-500/10 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                    Demo
                  </Badge>
                )}
                <Badge variant="outline" className={color.etiqueta}>{ETIQUETA_GRUPO[grupo]}</Badge>
                {detalle && <span className={cn('text-xs font-medium', color.texto)}>{detalle}</span>}
                {grupo === 'activas' && cobro && colorCobro && (
                  <>
                    <Badge variant="outline" className={colorCobro.etiqueta}>{ESTADO_COBRO_LABEL[cobro.estado]}</Badge>
                    {detalleEstado(cobro) && (
                      <span className={cn('text-xs font-medium', colorCobro.texto)}>{detalleEstado(cobro)}</span>
                    )}
                  </>
                )}
                {c.solo_ventas && (
                  <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    <Lock className="mr-1 h-3 w-3" /> Solo ventas
                  </Badge>
                )}
                {(cobro?.comprobantesPorConfirmar ?? 0) > 0 && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    <Clock className="mr-1 h-3 w-3" /> {formatCurrency(cobro!.porConfirmar)} por confirmar
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {getSectorLabel(c.business_type)} · {props.planDe(c.id)} · {activas} {activas === 1 ? 'sucursal' : 'sucursales'}
                {inactivas > 0 ? ` (+${inactivas} inactiva${inactivas === 1 ? '' : 's'})` : ''}
                {' · '}{c.rnc ? <span className="font-mono">RNC {c.rnc}</span> : 'sin RNC'}
                {' · '}{c.is_formalized ? 'Formalizada' : 'Informal'}
                {ecf && ` · ${ECF_ETIQUETA[ecf.estado]}${ecf.ambiente && ecf.ambiente !== 'eCF' ? ` (${ECF_AMBIENTE_NOMBRE[ecf.ambiente]})` : ''}`}
                {c.phone ? ` · ${c.phone}` : ''}
              </p>
            </div>
          </button>

          {/* Igual que en Cobros: en tablet los datos y los botones comparten
              renglón debajo del nombre; desde xl son columnas de la fila. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:contents">
            <div className="grid grid-cols-3 gap-3 text-sm sm:flex-1 xl:w-[440px] xl:flex-none xl:shrink-0">
              {grupo === 'activas' ? (
                <>
                  <Dato
                    titulo={cobro?.ciclo === 'annual' ? 'Por año' : 'Por mes'}
                    className="font-semibold"
                    nota={especialHasta
                      ? <span className="text-violet-700 dark:text-violet-400">especial hasta {fmtDate(especialHasta)}</span>
                      : (cobro?.preciosEspeciales ?? 0) > 0
                        ? <span className="text-violet-700 dark:text-violet-400">precio especial</span>
                        : undefined}
                  >
                    {cobro && cobro.montoPeriodo > 0 ? formatCurrency(cobro.montoPeriodo) : '—'}
                  </Dato>
                  {cobro && cobro.saldo > 0 && GRUPO_DE_ESTADO[cobro.estado] === 'atrasados' ? (
                    <Dato titulo="Debe" className={cn('font-bold', colorCobro?.texto)} nota={`desde ${fmtDate(cobro.debeDesde)}`}>
                      {formatCurrency(cobro.saldo)}
                    </Dato>
                  ) : (
                    <Dato titulo="Próximo cobro" nota={`cliente desde ${fmtDate(alta)}`}>
                      {fmtDate(cobro?.proximoCobro)}
                    </Dato>
                  )}
                </>
              ) : grupo === 'suspendidas' ? (
                <>
                  <Dato titulo="Alta" nota={`hace ${enDias(diasEntre(alta, hoy))}`}>{fmtDate(alta)}</Dato>
                  <Dato titulo="Suspendida" nota={esMotivoSuspension(c.suspension_reason) ? MOTIVO_SUSPENSION_INFO[c.suspension_reason].nombre : undefined}>
                    {fmtInstante(c.suspended_at)}
                  </Dato>
                </>
              ) : (
                <>
                  <Dato titulo="Alta" nota={`hace ${enDias(diasEntre(alta, hoy))}`}>{fmtDate(alta)}</Dato>
                  <Dato titulo="Prueba hasta" className={grupo === 'prueba_vencida' ? color.texto : undefined}>
                    {fmtDate(finPrueba)}
                  </Dato>
                </>
              )}
              <Dato
                titulo="Uso"
                nota={act?.ventas
                  ? `${act.ventas} venta${act.ventas === 1 ? '' : 's'} en 30 días`
                  : <span className="text-amber-700 dark:text-amber-400">sin ventas en 30 días</span>}
              >
                <Users className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                {usuarios} usuario{usuarios === 1 ? '' : 's'}
              </Dato>
            </div>

            <div className="flex gap-2 sm:shrink-0 sm:flex-col">
              {(grupo === 'prueba_vencida' || grupo === 'prueba') && (
                <Button size="sm" className="flex-1 sm:flex-none" onClick={() => props.onActivar(c)}>
                  <Zap className="mr-1.5 h-4 w-4" />
                  Activar
                </Button>
              )}
              {grupo === 'suspendidas' && props.onToggleStatus && (
                <Button size="sm" variant="outline" className="flex-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 sm:flex-none dark:border-emerald-900 dark:text-emerald-400" onClick={() => props.onToggleStatus!(c)}>
                  <Power className="mr-1.5 h-4 w-4" />
                  Reactivar
                </Button>
              )}
              <div className="flex flex-1 gap-2 sm:flex-none">
                <Button
                  size="sm" variant={grupo === 'activas' ? 'default' : 'outline'} className="flex-1"
                  onClick={() => props.onEnterCompany(c)}
                >
                  <LogIn className="mr-1.5 h-4 w-4" />
                  Entrar
                </Button>
                <MenuEmpresa company={c} acciones={props} />
              </div>
            </div>
          </div>
        </div>

        {abierta && (
          <div className="border-t bg-background/60 px-3 py-2 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Sucursales</p>
            <ul className="divide-y">
              {(c.branches ?? []).map((b) => {
                const tope = b.max_users;
                const ocupados = props.branchUserCounts?.[b.id];
                const cuenta = cobro?.cuentas.find((x) => x.branchId === b.id);
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className={cn('truncate', !b.is_active && 'text-muted-foreground line-through')}>{b.name}</span>
                      {!b.is_active && <Badge variant="destructive" className="h-4 px-1 text-[10px]">Inactiva</Badge>}
                      {tope != null && (
                        <Badge variant="outline" className={cn('h-4 gap-1 px-1 text-[10px] font-normal', (ocupados ?? 0) >= tope ? 'border-destructive/30 text-destructive' : 'text-muted-foreground')}>
                          <Users className="h-2.5 w-2.5" />
                          {ocupados != null ? `${ocupados} de ${tope}` : `${tope} reservados`}
                        </Badge>
                      )}
                      {cuenta?.precioEspecial && (
                        <Badge variant="outline" className="border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                          {formatCurrency(cuenta.cuota)}{cuenta.precioEspecialHasta ? ` hasta ${fmtDate(cuenta.precioEspecialHasta)}` : ''}
                        </Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      {cuenta && (
                        <span className="mr-2 text-xs text-muted-foreground">
                          se cobra desde {fmtDate(cuenta.desde)}{cuenta.proximaCuota ? ` · próxima ${fmtDate(cuenta.proximaCuota)}` : ''}
                        </span>
                      )}
                      <Button
                        variant="secondary" size="sm" className="h-7 px-3 text-[11px]"
                        onClick={() => props.onEnterBranch(c.id, c.name, b.id, b.name)}
                      >
                        <LogIn className="mr-1 h-3 w-3" /> Entrar
                      </Button>
                      <MenuSucursal company={c} sucursal={b} acciones={props} />
                    </span>
                  </li>
                );
              })}
              {(c.branches ?? []).length === 0 && (
                <li className="py-1.5 text-xs text-muted-foreground">Sin sucursales.</li>
              )}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              {props.onAddBranch ? (
                <Button
                  variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => props.onAddBranch!(c)}
                >
                  <PlusCircle className="mr-1 h-3 w-3" /> Agregar sucursal
                </Button>
              ) : <span />}
              {cobro && cobro.cuentas.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Cargado {formatCurrency(cobro.cargado)} · Pagado {formatCurrency(cobro.pagado)}
                  {cobro.saldo > 0 ? ` · Debe ${formatCurrency(cobro.saldo)}` : cobro.saldo < 0 ? ` · A favor ${formatCurrency(-cobro.saldo)}` : ''}
                  {' · '}<Link href="/admin/cobros" className="underline underline-offset-2 hover:text-foreground">ver en Cobros</Link>
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
