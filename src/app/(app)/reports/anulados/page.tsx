'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, Ban, Loader2, Undo2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn, formatCurrency } from '@/lib/utils';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { ExportButton } from '@/components/reports/export-button';

// 'none' = la venta se facturó por error y nunca se cobró, así que no hubo
// dinero que devolver. Se muestra aparte porque no sale de la caja.
const REFUND_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  none: 'Sin devolución',
};

const REFUND_STYLE: Record<string, string> = {
  cash: 'bg-green-100 border-green-600 text-green-800',
  card: 'bg-blue-100 border-blue-600 text-blue-800',
  transfer: 'bg-orange-100 border-orange-500 text-orange-800',
  none: 'bg-muted border-muted-foreground/40 text-muted-foreground',
};

// Una nota de crédito por venta anulada: es la fuente, no `sales`, porque
// guarda el motivo, quién anuló y cómo se devolvió el dinero.
type FilaNota = {
  id: string;
  sale_id: string;
  branch_id: string | null;
  ncf: string | null;
  ncf_modified: string | null;
  total: number | null;
  refund_method: string | null;
  reason: string | null;
  user_name: string | null;
  created_at: string;
  customers: { name: string | null } | null;
  sales: { created_at: string; user_name: string | null } | null;
};

export default function AnuladosPage() {
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [notas, setNotas] = React.useState<FilaNota[]>([]);
  const [loading, setLoading] = React.useState(true);

  const esAdmin = appUser?.role === 'admin';

  // Quien no es admin ve su sucursal y punto (RLS ya se lo impone; esto solo
  // evita que el selector prometa algo que la base va a negar).
  React.useEffect(() => {
    if (!esAdmin && appUser?.activeBranchId) setSelectedBranch(appUser.activeBranchId);
  }, [esAdmin, appUser?.activeBranchId]);

  const desde = date?.from;
  const hasta = date?.to ?? date?.from;
  const desdeIso = React.useMemo(() => {
    if (!desde) return null;
    const d = new Date(desde);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [desde]);
  const hastaIso = React.useMemo(() => {
    if (!hasta) return null;
    const d = new Date(hasta);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [hasta]);

  React.useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      if (!desdeIso || !hastaIso) return;
      setLoading(true);
      // El rango filtra por la fecha de ANULACIÓN, no la de la venta: lo que se
      // audita es cuándo se anuló. La fecha de la venta va en la tabla aparte,
      // porque casi siempre es otra.
      let q = supabase
        .from('credit_notes')
        .select('id,sale_id,branch_id,ncf,ncf_modified,total,refund_method,reason,user_name,created_at,customers(name),sales(created_at,user_name)')
        .gte('created_at', desdeIso)
        .lte('created_at', hastaIso)
        .order('created_at', { ascending: false });
      if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (cancelado) return;
      setNotas(error || !data ? [] : (data as unknown as FilaNota[]));
      setLoading(false);
    };
    cargar();
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, selectedBranch]);

  const sucursales = React.useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id, b.displayName?.trim() || b.name));
    return map;
  }, [branches]);

  const totales = React.useMemo(() => {
    let anuladas = 0;
    let monto = 0;
    let devuelto = 0;
    let sinDevolucion = 0;
    notas.forEach((n) => {
      const t = Number(n.total ?? 0);
      anuladas += 1;
      monto += t;
      if (n.refund_method === 'none') sinDevolucion += t;
      else devuelto += t;
    });
    return { anuladas, monto, devuelto, sinDevolucion };
  }, [notas]);

  const columnasCsv = React.useMemo(
    () => [
      { header: 'Fecha anulación', value: (n: FilaNota) => new Date(n.created_at).toLocaleString('es-DO') },
      { header: 'Fecha venta', value: (n: FilaNota) => (n.sales ? new Date(n.sales.created_at).toLocaleString('es-DO') : '') },
      { header: 'Venta', value: (n: FilaNota) => n.sale_id.slice(0, 8).toUpperCase() },
      { header: 'Sucursal', value: (n: FilaNota) => (n.branch_id ? sucursales.get(n.branch_id) ?? '' : '') },
      { header: 'Cliente', value: (n: FilaNota) => n.customers?.name ?? 'Consumidor Final' },
      { header: 'Total', value: (n: FilaNota) => Number(n.total ?? 0) },
      { header: 'Devolución', value: (n: FilaNota) => (n.refund_method ? REFUND_LABEL[n.refund_method] ?? n.refund_method : '') },
      { header: 'Motivo', value: (n: FilaNota) => n.reason ?? '' },
      { header: 'Facturó', value: (n: FilaNota) => n.sales?.user_name ?? '' },
      { header: 'Anuló', value: (n: FilaNota) => n.user_name ?? '' },
      { header: 'NC (B04)', value: (n: FilaNota) => n.ncf ?? '' },
      { header: 'NCF anulado', value: (n: FilaNota) => n.ncf_modified ?? '' },
    ],
    [sucursales],
  );

  return (
    <div>
      <PageHeader title="Reporte de Ventas Anuladas">
        <div className="flex flex-wrap items-center gap-2">
          {esAdmin && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-[260px] justify-start text-left font-normal', !date && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'd LLL y', { locale: es })} — {format(date.to, 'd LLL y', { locale: es })}
                    </>
                  ) : (
                    format(date.from, 'd LLL y', { locale: es })
                  )
                ) : (
                  <span>Elige un rango</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={es}
              />
            </PopoverContent>
          </Popover>

          <ExportButton filename="ventas-anuladas" columns={columnasCsv} rows={notas} />
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ventas anuladas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              {totales.anuladas}
            </div>
            <CardDescription className="mt-1">{formatCurrency(totales.monto)} en total</CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dinero devuelto</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-amber-500" />
              {formatCurrency(totales.devuelto)}
            </div>
            <CardDescription className="mt-1">Salió por caja, tarjeta o transferencia</CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sin devolución</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totales.sinDevolucion)}</div>
            <CardDescription className="mt-1">Facturadas por error, nunca se cobraron</CardDescription>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle</CardTitle>
          <CardDescription>
            Por fecha de anulación. Cada línea es una nota de crédito: la venta sigue guardada, marcada como anulada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
            </div>
          ) : notas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay ventas anuladas en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anulada</TableHead>
                    <TableHead>Venta</TableHead>
                    {esAdmin && selectedBranch === 'all' && <TableHead>Sucursal</TableHead>}
                    <TableHead>Cliente</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Facturó / Anuló</TableHead>
                    <TableHead>Devolución</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notas.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(n.created_at).toLocaleString('es-DO')}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">#{n.sale_id.slice(0, 8).toUpperCase()}</span>
                        {n.sales && (
                          <div className="text-muted-foreground">
                            {new Date(n.sales.created_at).toLocaleDateString('es-DO')}
                          </div>
                        )}
                        {n.ncf && <div className="font-mono text-muted-foreground">NC {n.ncf}</div>}
                      </TableCell>
                      {esAdmin && selectedBranch === 'all' && (
                        <TableCell className="text-xs">
                          {n.branch_id ? sucursales.get(n.branch_id) ?? '—' : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-xs">{n.customers?.name ?? 'Consumidor Final'}</TableCell>
                      <TableCell className="text-xs max-w-[240px]">
                        {n.reason ?? <span className="text-muted-foreground">Sin motivo</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {n.sales?.user_name ?? '—'}
                        <div className="text-muted-foreground">{n.user_name ?? '—'}</div>
                      </TableCell>
                      <TableCell>
                        {n.refund_method ? (
                          <Badge
                            variant="outline"
                            className={cn('font-semibold text-xs', REFUND_STYLE[n.refund_method])}
                          >
                            {REFUND_LABEL[n.refund_method] ?? n.refund_method}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(Number(n.total ?? 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={esAdmin && selectedBranch === 'all' ? 7 : 6} className="font-bold">
                      Total anulado
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totales.monto)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
