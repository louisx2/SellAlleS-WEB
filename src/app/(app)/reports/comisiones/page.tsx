'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { BadgePercent, Loader2, UserCog, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExportButton } from '@/components/reports/export-button';
import { FiltroPeriodo, rangoMesActual, useFiltroSucursal } from '@/components/reports/filtro-periodo';
import { PorcentajesComision } from '@/components/reports/porcentajes-comision';
import { useVentasPeriodo } from '@/hooks/use-ventas-periodo';
import { useVendedores } from '@/hooks/use-vendedores';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { baseComisionable, comisionDeVenta, formatPorcentaje } from '@/lib/comisiones';
import type { Sale } from '@/lib/types';

type Fila = {
  clave: string;
  nombre: string;
  ventas: number;
  base: number;
  comision: number;
  /** Ventas que no comisionan: hechas antes de encender el módulo o por alguien sin membresía. */
  sinPorcentaje: number;
  anuladas: number;
  /** % de hoy (solo lo ve el admin). */
  pctActual: number | null;
};

// Las ventas de antes del módulo no tienen vendedor: se agrupan por quien cobró.
const claveDe = (s: Sale) => s.sellerId ?? `nombre:${s.sellerName ?? s.userName ?? 'Desconocido'}`;

export default function ComisionesReportPage() {
  const { toast } = useToast();
  const [rango, setRango] = React.useState<DateRange | undefined>(rangoMesActual);
  const { branchId, setBranchId, esAdmin } = useFiltroSucursal();
  const { ventas, loading, error, recargar } = useVentasPeriodo({ rango, branchId, conItems: false });
  const { vendedores, loading: cargandoVendedores, recargar: recargarVendedores } = useVendedores(true);
  const [seleccion, setSeleccion] = React.useState<string | null>(null);
  const [editando, setEditando] = React.useState<{ saleId: string; sellerId: string } | null>(null);
  const [guardando, setGuardando] = React.useState(false);

  const porId = React.useMemo(() => new Map(vendedores.map((v) => [v.id, v])), [vendedores]);

  const filas = React.useMemo(() => {
    const map = new Map<string, Fila>();
    for (const s of ventas) {
      const clave = claveDe(s);
      const perfil = s.sellerId ? porId.get(s.sellerId) : undefined;
      const acc = map.get(clave) ?? {
        clave,
        nombre: perfil?.nombre ?? s.sellerName ?? s.userName ?? 'Desconocido',
        ventas: 0, base: 0, comision: 0, sinPorcentaje: 0, anuladas: 0,
        pctActual: perfil?.commissionRate ?? null,
      };
      if (s.cancelledAt) {
        acc.anuladas += 1;
      } else {
        acc.ventas += 1;
        acc.base += baseComisionable(s);
        acc.comision += comisionDeVenta(s);
        if (s.commissionRate == null) acc.sinPorcentaje += 1;
      }
      map.set(clave, acc);
    }
    return Array.from(map.values()).sort((a, b) => b.comision - a.comision || b.base - a.base);
  }, [ventas, porId]);

  const totales = React.useMemo(
    () => filas.reduce(
      (t, f) => ({ ventas: t.ventas + f.ventas, base: t.base + f.base, comision: t.comision + f.comision }),
      { ventas: 0, base: 0, comision: 0 },
    ),
    [filas],
  );

  const detalle = React.useMemo(
    () => (seleccion
      ? ventas.filter((s) => claveDe(s) === seleccion).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      : []),
    [ventas, seleccion],
  );
  const filaSeleccionada = filas.find((f) => f.clave === seleccion);

  const cambiarVendedor = async () => {
    if (!editando) return;
    setGuardando(true);
    const { error: err } = await supabase.rpc('cambiar_vendedor_venta', {
      p_sale_id: editando.saleId,
      p_seller_id: editando.sellerId,
    });
    setGuardando(false);
    if (err) {
      toast({ title: 'No se cambió el vendedor', description: err.message, variant: 'destructive' });
      return;
    }
    const nuevo = porId.get(editando.sellerId);
    toast({ title: 'Vendedor cambiado', description: `La venta ahora comisiona para ${nuevo?.nombre ?? 'el vendedor elegido'}.` });
    setEditando(null);
    recargar();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Comisiones por Vendedor">
        <div className="flex flex-wrap items-center gap-2">
          <FiltroPeriodo rango={rango} onRango={setRango} branchId={branchId} onBranch={setBranchId} esAdmin={esAdmin} />
          <ExportButton
            filename="comisiones_por_vendedor"
            rows={filas}
            columns={[
              { header: 'Vendedor', value: (f) => f.nombre },
              { header: 'Ventas', value: (f) => f.ventas },
              { header: 'Vendido sin ITBIS', value: (f) => f.base },
              { header: 'Comision', value: (f) => f.comision },
              { header: 'Ventas sin %', value: (f) => f.sinPorcentaje },
              { header: 'Anuladas', value: (f) => f.anuladas },
            ]}
          />
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Comisiones del período</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{formatCurrency(totales.comision)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Vendido sin ITBIS</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(totales.base)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Ventas</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totales.ventas}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="h-5 w-5" />
            <span>Comisión de cada vendedor</span>
          </CardTitle>
          <CardDescription>
            Cada venta comisiona con el % que el vendedor tenía el día que se hizo, sobre lo vendido sin ITBIS.
            Las anuladas no comisionan. Toca un vendedor para ver sus ventas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Vendido sin ITBIS</TableHead>
                  {esAdmin && <TableHead className="text-right">% actual</TableHead>}
                  <TableHead className="text-right">Comisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={esAdmin ? 5 : 4} className="h-24 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={esAdmin ? 5 : 4} className="h-24 text-center">
                      No hay ventas en este rango de fechas.
                    </TableCell>
                  </TableRow>
                ) : (
                  filas.map((f) => (
                    <TableRow
                      key={f.clave}
                      className={`cursor-pointer ${seleccion === f.clave ? 'bg-muted/60' : ''}`}
                      onClick={() => setSeleccion(seleccion === f.clave ? null : f.clave)}
                    >
                      <TableCell>
                        <div className="font-medium">{f.nombre}</div>
                        {(f.sinPorcentaje > 0 || f.anuladas > 0) && (
                          <div className="text-xs text-muted-foreground">
                            {f.sinPorcentaje > 0 && `${f.sinPorcentaje} sin % de comisión`}
                            {f.sinPorcentaje > 0 && f.anuladas > 0 && ' · '}
                            {f.anuladas > 0 && `${f.anuladas} anulada${f.anuladas === 1 ? '' : 's'}`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{f.ventas}</TableCell>
                      <TableCell className="text-right">{formatCurrency(f.base)}</TableCell>
                      {esAdmin && <TableCell className="text-right">{formatPorcentaje(f.pctActual)}</TableCell>}
                      <TableCell className="text-right font-bold">{formatCurrency(f.comision)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {!loading && filas.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold">{totales.ventas}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totales.base)}</TableCell>
                    {esAdmin && <TableCell />}
                    <TableCell className="text-right font-bold">{formatCurrency(totales.comision)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      {filaSeleccionada && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Ventas de {filaSeleccionada.nombre}</CardTitle>
              <CardDescription>
                {esAdmin
                  ? 'Si una venta quedó a nombre de otra persona, cámbiala aquí: toma el % que el vendedor nuevo tiene hoy.'
                  : 'Las ventas del período que comisionan para este vendedor.'}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSeleccion(null)} aria-label="Cerrar detalle">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Sin ITBIS</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Comisión</TableHead>
                    {esAdmin && <TableHead className="w-[1%]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalle.map((s) => (
                    <TableRow key={s.id} className={s.cancelledAt ? 'text-muted-foreground line-through' : ''}>
                      <TableCell className="whitespace-nowrap">{format(s.createdAt, "d LLL y, h:mm a", { locale: es })}</TableCell>
                      <TableCell>{s.customer?.name ?? 'Cliente Genérico'}</TableCell>
                      <TableCell>{s.branchId}</TableCell>
                      <TableCell className="text-right">{formatCurrency(baseComisionable(s))}</TableCell>
                      <TableCell className="text-right">{formatPorcentaje(s.commissionRate)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(comisionDeVenta(s))}</TableCell>
                      {esAdmin && (
                        <TableCell>
                          {s.cancelledAt ? null : editando?.saleId === s.id ? (
                            <div className="flex items-center gap-2">
                              <Select value={editando.sellerId} onValueChange={(v) => setEditando({ saleId: s.id, sellerId: v })}>
                                <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Vendedor" /></SelectTrigger>
                                <SelectContent>
                                  {vendedores.filter((v) => v.activo || v.id === s.sellerId).map((v) => (
                                    <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button size="sm" onClick={cambiarVendedor}
                                disabled={guardando || !editando.sellerId || editando.sellerId === s.sellerId}>
                                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setEditando({ saleId: s.id, sellerId: s.sellerId ?? '' })}>
                              <UserCog className="mr-1 h-4 w-4" />
                              Cambiar
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {esAdmin && (
        <PorcentajesComision vendedores={vendedores} loading={cargandoVendedores} onGuardado={recargarVendedores} />
      )}
    </div>
  );
}
