'use client';

import * as React from 'react';
import Link from 'next/link';
import { endOfDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { FiltroPeriodo, rangoMesActual, useFiltroSucursal } from '@/components/reports/filtro-periodo';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { rowToServiceEvent, rowToServiceItem } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { caseNumber, SERVICE_STATUS, STATUS_ORDER, statusLabel, type StatusCtx } from '@/lib/taller';
import {
  duracion, enRango, porTecnico, resumen, tiempoPorEstado, topEquipos, topLineas,
  type CasoReporte, type Rango,
} from '@/lib/taller-reportes';
import type { ServiceEvent, ServiceItem, ServiceStatus } from '@/lib/types';

const LOTE = 200;
const DIA = 86_400_000;

async function enLotes<T>(ids: string[], leer: (lote: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data } = await leer(ids.slice(i, i + LOTE));
    out.push(...(data ?? []));
  }
  return out;
}

function Kpi({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardDescription>{titulo}</CardDescription></CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{valor}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  );
}

export default function ServiciosReportPage() {
  const { toast } = useToast();
  const [rango, setRango] = React.useState<DateRange | undefined>(rangoMesActual);
  const { branchId, setBranchId, esAdmin } = useFiltroSucursal();
  const [loading, setLoading] = React.useState(true);
  const [casos, setCasos] = React.useState<CasoReporte[]>([]);
  const [lineas, setLineas] = React.useState<ServiceItem[]>([]);
  const [eventos, setEventos] = React.useState<Map<string, ServiceEvent[]>>(new Map());
  const [rapidas, setRapidas] = React.useState<Set<string>>(new Set());
  const [originales, setOriginales] = React.useState<Map<string, { assignedTo?: string }>>(new Map());
  // El camino de cada orden: de él salen las palabras de sus estados.
  const [caminos, setCaminos] = React.useState<Map<string, StatusCtx>>(new Map());

  const r: Rango | null = rango?.from
    ? { from: startOfDay(rango.from), to: endOfDay(rango.to ?? rango.from) }
    : null;
  const desde = r?.from.toISOString();
  const hasta = r?.to.toISOString();

  const cargar = React.useCallback(async () => {
    if (!desde || !hasta) return;
    setLoading(true);
    // Órdenes que tocan el período (entraron, quedaron listos o se entregaron) más
    // todos los que siguen abiertos.
    let q = supabase
      .from('services')
      .select('id, number, status, staff_id, customer_id, created_at, ready_at, delivered_at, outcome, labor_price, parts_total, total, sale_id, warranty_of_service_id, warranty_sale_id, promised_at, is_quick, stays_in_shop, is_repair, equipment_brand, equipment_model, brought_by_name, brought_by_phone, service_staff!services_staff_id_fkey(name), customers(name, phone), service_equipment_types(name)')
      .or([
        `and(created_at.gte.${desde},created_at.lte.${hasta})`,
        `and(ready_at.gte.${desde},ready_at.lte.${hasta})`,
        `and(delivered_at.gte.${desde},delivered_at.lte.${hasta})`,
        'status.not.in.(delivered,cancelled)',
        'sale_id.not.is.null',
      ].join(','))
      .order('created_at', { ascending: false })
      .limit(5000);
    if (branchId !== 'all') q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) {
      setLoading(false);
      toast({ title: 'No se pudo cargar el reporte', description: error.message, variant: 'destructive' });
      return;
    }
    const rows = data ?? [];
    const lista: CasoReporte[] = rows.map((s: any) => ({
      id: s.id,
      number: Number(s.number),
      status: s.status,
      assignedTo: s.staff_id ?? undefined,
      assignedName: s.service_staff?.name ?? undefined,
      customerName: s.customers?.name ?? s.brought_by_name ?? undefined,
      customerPhone: s.customers?.phone ?? s.brought_by_phone ?? undefined,
      equipmentType: s.service_equipment_types?.name ?? undefined,
      equipment: [s.equipment_brand, s.equipment_model].filter(Boolean).join(' ') || undefined,
      createdAt: new Date(s.created_at),
      readyAt: s.ready_at ? new Date(s.ready_at) : undefined,
      deliveredAt: s.delivered_at ? new Date(s.delivered_at) : undefined,
      outcome: s.outcome ?? undefined,
      laborPrice: Number(s.labor_price ?? 0),
      partsTotal: Number(s.parts_total ?? 0),
      total: Number(s.total ?? 0),
      saleId: s.sale_id ?? undefined,
      warrantyOf: s.warranty_of_service_id ?? undefined,
      warrantySale: s.warranty_sale_id ?? undefined,
      promisedAt: s.promised_at ? new Date(s.promised_at) : undefined,
    }));
    const ids = lista.map((c) => c.id);
    const [its, evs] = await Promise.all([
      enLotes<any>(ids, (lote) => supabase.from('service_items').select('*, products(name)').in('service_id', lote)),
      enLotes<any>(ids, (lote) => supabase.from('service_events').select('*').in('service_id', lote).in('kind', ['created', 'status', 'charged', 'charge_voided'])),
    ]);
    const porCaso = new Map<string, ServiceEvent[]>();
    for (const e of evs) {
      const ev = rowToServiceEvent(e);
      porCaso.set(e.service_id, [...(porCaso.get(e.service_id) ?? []), ev]);
    }
    // De quién era el caso que volvió por garantía (puede ser de antes del período).
    const faltan = Array.from(new Set(lista.map((c) => c.warrantyOf).filter((x): x is string => !!x && !ids.includes(x))));
    const extra = await enLotes<any>(faltan, (lote) => supabase.from('services').select('id, staff_id').in('id', lote));
    const orig = new Map<string, { assignedTo?: string }>();
    for (const c of lista) orig.set(c.id, { assignedTo: c.assignedTo });
    for (const o of extra) orig.set(o.id, { assignedTo: o.staff_id ?? undefined });

    setCasos(lista);
    setLineas(its.map(rowToServiceItem));
    setEventos(porCaso);
    setRapidas(new Set(rows.filter((s: any) => s.is_quick).map((s: any) => s.id)));
    setCaminos(new Map(rows.map((s: any) => [s.id, { staysInShop: s.stays_in_shop !== false, isRepair: s.is_repair !== false }])));
    setOriginales(orig);
    setLoading(false);
  }, [desde, hasta, branchId, toast]);

  React.useEffect(() => { cargar(); }, [cargar]);

  const res = r ? resumen(casos, lineas, eventos, r, rapidas) : null;
  const tecnicos = r ? porTecnico(casos, eventos, r, originales) : [];
  const etapas = r ? tiempoPorEstado(eventos, r) : [];
  const enPeriodo = new Set(casos.filter((c) => r && enRango(c.createdAt, r)).map((c) => c.id));
  const servicios = topLineas(lineas, 'labor', enPeriodo).slice(0, 15);
  const piezas = topLineas(lineas, 'part', enPeriodo).slice(0, 15);
  const equipos = r ? topEquipos(casos, r).slice(0, 15) : [];
  const caminoDe = (id: string): StatusCtx => caminos.get(id) ?? { staysInShop: true, isRepair: true };
  // Las palabras de reparación solo cuando hay (o solo hay) órdenes de reparación.
  const hayReparacion = casos.some((c) => caminoDe(c.id).isRepair);
  const soloReparacion = casos.length > 0 && casos.every((c) => caminoDe(c.id).isRepair);
  // Cada estado con el texto del camino de cada orden («En reparación» / «En proceso»).
  const ahoraPorEstado = STATUS_ORDER
    .filter((s) => s !== 'delivered' && s !== 'cancelled')
    .flatMap((s) => {
      const porTexto = new Map<string, number>();
      for (const c of casos) {
        if (c.status !== s) continue;
        const texto = statusLabel(s as ServiceStatus, caminoDe(c.id));
        porTexto.set(texto, (porTexto.get(texto) ?? 0) + 1);
      }
      return Array.from(porTexto, ([texto, n]) => ({ clave: `${s}:${texto}`, texto, casos: n }));
    });
  // El tiempo en cada etapa junta órdenes de todos los caminos: texto neutro.
  const etapaCtx: StatusCtx = { staysInShop: true, isRepair: soloReparacion };
  const sinRetirar = casos
    .filter((c) => (c.status === 'ready' || c.status === 'not_repaired') && c.readyAt)
    .sort((a, b) => a.readyAt!.getTime() - b.readyAt!.getTime());
  const margenPiezas = res ? res.piezasVenta - res.piezasCosto : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Servicios">
        <FiltroPeriodo rango={rango} onRango={setRango} branchId={branchId} onBranch={setBranchId} esAdmin={esAdmin} />
      </PageHeader>

      {loading || !res ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculando…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Ingresaron" valor={String(res.ingresados)} detalle={`${res.rapidas} de Atender ahora · ${res.garantias} por garantía`} />
            <Kpi titulo="Entregados" valor={String(res.entregados)} detalle={hayReparacion && res.entregados ? `${res.noReparados} sin reparar (${Math.round((res.noReparados / res.entregados) * 100)}%)` : undefined} />
            <Kpi titulo="En curso ahora" valor={String(res.enTaller)} detalle={res.atrasados ? `${res.atrasados} atrasados` : 'Ninguno atrasado'} />
            <Kpi titulo="Listos sin retirar" valor={String(res.listos)} detalle={res.listosViejos ? `${res.listosViejos} con más de 7 días` : undefined} />
            <Kpi titulo="Cobrado" valor={formatCurrency(res.facturado)} detalle={`${res.cobrados} órdenes cobradas en el período`} />
            <Kpi titulo="Mano de obra" valor={formatCurrency(res.manoDeObra)} />
            <Kpi titulo="Piezas y materiales" valor={formatCurrency(res.piezasVenta)} detalle={`Costo ${formatCurrency(res.piezasCosto)} · ganancia ${formatCurrency(margenPiezas)}`} />
            <Kpi titulo="Tiempo de atención" valor={duracion(res.tiempoReparacion)} detalle={`De entrada a listo · entrega: ${duracion(res.tiempoEntrega)}`} />
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="text-base">Por personal</CardTitle>
                <CardDescription>Según quién tiene la orden ahora. Reingresos: órdenes suyas que volvieron por garantía.</CardDescription>
              </div>
              <ExportButton
                filename="servicios_por_personal"
                rows={tecnicos}
                columns={[
                  { header: 'Lo atiende', value: (f) => f.nombre },
                  { header: 'Asignados', value: (f) => f.asignados },
                  { header: 'Terminados', value: (f) => f.terminados },
                  { header: 'En curso', value: (f) => f.enCurso },
                  { header: 'Tiempo promedio (horas)', value: (f) => (f.tiempoPromedio == null ? '' : Math.round(f.tiempoPromedio / 3_600_000)) },
                  { header: 'Mano de obra cobrada', value: (f) => f.manoDeObra },
                  { header: 'Reingresos por garantia', value: (f) => f.reingresos },
                ]}
              />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lo atiende</TableHead>
                    <TableHead className="text-right">Asignados</TableHead>
                    <TableHead className="text-right">Terminados</TableHead>
                    <TableHead className="text-right">En curso</TableHead>
                    <TableHead className="text-right">Tiempo promedio</TableHead>
                    <TableHead className="text-right">Mano de obra</TableHead>
                    <TableHead className="text-right">Reingresos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tecnicos.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sin movimiento en el período.</TableCell></TableRow>
                  )}
                  {tecnicos.map((f) => (
                    <TableRow key={f.clave}>
                      <TableCell className="font-medium">{f.nombre}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.asignados}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.terminados}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.enCurso}</TableCell>
                      <TableCell className="text-right">{duracion(f.tiempoPromedio)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(f.manoDeObra)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${f.reingresos ? 'text-destructive font-medium' : ''}`}>{f.reingresos}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Órdenes abiertas por estado</CardTitle>
                <CardDescription>Cómo está el trabajo ahora mismo.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {ahoraPorEstado.length === 0 && <TableRow><TableCell className="text-muted-foreground">No hay órdenes abiertas.</TableCell></TableRow>}
                    {ahoraPorEstado.map((x) => (
                      <TableRow key={x.clave}>
                        <TableCell>{x.texto}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{x.casos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tiempo en cada etapa</CardTitle>
                <CardDescription>Promedio de lo que pasa una orden en cada estado antes de cambiar. Muestra dónde se atasca.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Estado</TableHead><TableHead className="text-right">Promedio</TableHead><TableHead className="text-right">Veces</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {etapas.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Sin cambios de estado en el período.</TableCell></TableRow>}
                    {etapas.map((e) => (
                      <TableRow key={e.estado}>
                        <TableCell>{SERVICE_STATUS[e.estado] ? statusLabel(e.estado, etapaCtx) : e.estado}</TableCell>
                        <TableCell className="text-right">{duracion(e.promedio)}</TableCell>
                        <TableCell className="text-right tabular-nums">{e.veces}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Servicios más pedidos</CardTitle>
                <CardDescription>Mano de obra de las órdenes que entraron en el período.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Servicio</TableHead><TableHead className="text-right">Veces</TableHead><TableHead className="text-right">Monto</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {servicios.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Sin servicios en el período.</TableCell></TableRow>}
                    {servicios.map((s) => (
                      <TableRow key={s.nombre}>
                        <TableCell>{s.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.veces}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(s.venta)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Piezas y materiales más usados</CardTitle>
                <CardDescription>Salieron del inventario para las órdenes del período.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Artículo</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">Costo</TableHead><TableHead className="text-right">Venta</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {piezas.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Sin piezas ni materiales en el período.</TableCell></TableRow>}
                    {piezas.map((p) => (
                      <TableRow key={p.nombre}>
                        <TableCell>{p.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.cantidad}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(p.costo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(p.venta)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fichas más atendidas</CardTitle>
                <CardDescription>Lo que entró en el período.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {equipos.length === 0 && <TableRow><TableCell className="text-muted-foreground">Sin órdenes en el período.</TableCell></TableRow>}
                    {equipos.map((e) => (
                      <TableRow key={e.nombre}>
                        <TableCell>{e.nombre}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{e.veces}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base">Listos sin retirar</CardTitle>
                  <CardDescription>Los que más tiempo llevan esperando primero. Avísales.</CardDescription>
                </div>
                <ExportButton
                  filename="servicios_listos_sin_retirar"
                  rows={sinRetirar}
                  columns={[
                    { header: 'Orden', value: (c) => caseNumber(c.number) },
                    { header: 'Cliente', value: (c) => c.customerName ?? '' },
                    { header: 'Telefono', value: (c) => c.customerPhone ?? '' },
                    { header: 'Ficha', value: (c) => c.equipment ?? '' },
                    { header: 'Dias esperando', value: (c) => Math.floor((Date.now() - c.readyAt!.getTime()) / DIA) },
                    { header: 'Total', value: (c) => c.total },
                  ]}
                />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {sinRetirar.length === 0 && <TableRow><TableCell className="text-muted-foreground">No hay nada esperando.</TableCell></TableRow>}
                    {sinRetirar.slice(0, 30).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link className="font-medium hover:underline" href={`/services/caso?id=${c.id}`}>{caseNumber(c.number)}</Link>
                          <div className="text-xs text-muted-foreground">{c.customerName ?? 'Consumidor final'}{c.customerPhone ? ` · ${c.customerPhone}` : ''}</div>
                        </TableCell>
                        <TableCell className="text-sm">{c.equipment ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{Math.floor((Date.now() - c.readyAt!.getTime()) / DIA)} d</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
