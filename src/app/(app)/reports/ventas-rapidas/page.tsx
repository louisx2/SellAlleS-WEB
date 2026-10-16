'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, DollarSign, Loader2, Receipt, TrendingUp, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatCurrency, ITBIS_RATE } from '@/lib/utils';
import { formatQty } from '@/lib/units';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { summarizeQuickLines, type QuickReportLine } from '@/lib/quick-sales';
import { ExportButton } from '@/components/reports/export-button';

// Una línea rápida con la venta que la trae. `sales!inner` es un embed
// muchos-a-uno, así que PostgREST devuelve un objeto, no una lista.
// Los numeric pueden llegar como número o como texto: se normalizan con Number.
type FilaRapida = {
  id: string;
  product_name: string;
  quantity: number | string;
  price: number | string;
  custom_price: number | string | null;
  cost: number | string | null;
  itbis: boolean;
  sales: {
    id: string;
    ncf: string | null;
    created_at: string;
    user_name: string | null;
    branch_id: string | null;
    itbis_included: boolean | null;
    cancelled_at: string | null;
  };
};

// Lo que se cobró por unidad: manda el precio puesto a mano en la venta, igual
// que en el resto de los reportes (`customPrice ?? price`).
const precioUnitario = (f: FilaRapida) => Number(f.custom_price ?? f.price);
const totalDeLinea = (f: FilaRapida) => Number(f.quantity) * precioUnitario(f);
const costoDeLinea = (f: FilaRapida) => (f.cost != null ? Number(f.cost) : null);
// Igual que el recibo y el nombre del PDF de la factura: el NCF si lo hay, y si
// no los primeros 8 caracteres del id.
const ventaDeLinea = (f: FilaRapida) => f.sales.ncf || f.sales.id.slice(0, 8).toUpperCase();

export default function VentasRapidasPage() {
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [selectedUser, setSelectedUser] = React.useState('all');
  const [filas, setFilas] = React.useState<FilaRapida[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [fallo, setFallo] = React.useState(false);

  const esAdmin = appUser?.role === 'admin';
  // Quien no es admin ve su sucursal y punto (RLS ya se lo impone; esto solo
  // evita que el selector prometa algo que la base va a negar).
  const sucursalId = esAdmin ? selectedBranch : (appUser?.activeBranchId ?? 'all');

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
      setFallo(false);
      try {
        // Se pide por páginas: un rango largo pasa de las 1000 filas que PostgREST
        // corta sin avisar, y los totales saldrían bajos. Las anuladas se
        // excluyen; la venta anulada sigue guardada pero no cuenta como vendida.
        const data = await fetchAllRows<FilaRapida>((desdePag, hastaPag) => {
          let q = supabase
            .from('sale_items')
            .select('id, product_name, quantity, price, custom_price, cost, itbis, sales!inner(id, ncf, created_at, user_name, branch_id, itbis_included, cancelled_at)')
            .eq('is_quick', true)
            .is('sales.cancelled_at', null)
            .gte('sales.created_at', desdeIso)
            .lte('sales.created_at', hastaIso)
            .order('id');
          if (sucursalId !== 'all') q = q.eq('sales.branch_id', sucursalId);
          return q.range(desdePag, hastaPag) as unknown as PromiseLike<{ data: FilaRapida[] | null; error: any }>;
        });
        if (cancelado) return;
        // De la venta más reciente a la más vieja. Se ordena aquí y no en la
        // consulta porque la paginación necesita una columna estable (`id`).
        data.sort((a, b) => new Date(b.sales.created_at).getTime() - new Date(a.sales.created_at).getTime());
        setFilas(data);
      } catch {
        if (cancelado) return;
        setFilas([]);
        setFallo(true);
      }
      setLoading(false);
    };
    cargar();
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, sucursalId]);

  const sucursales = React.useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id, b.displayName?.trim() || b.name));
    return map;
  }, [branches]);

  // El selector de usuario sale de lo que trajo la consulta: así solo ofrece
  // quien de verdad vendió algo rápido en el período.
  const usuarios = React.useMemo(
    () => Array.from(new Set(filas.map((f) => f.sales.user_name).filter((u): u is string => !!u))).sort((a, b) => a.localeCompare(b, 'es')),
    [filas],
  );
  // Si al cambiar el rango el usuario elegido ya no aparece, se vuelve a "Todos"
  // en vez de dejar una tabla vacía con un selector que no explica por qué.
  const usuarioActivo = usuarios.includes(selectedUser) ? selectedUser : 'all';

  const visibles = React.useMemo(
    () => (usuarioActivo === 'all' ? filas : filas.filter((f) => f.sales.user_name === usuarioActivo)),
    [filas, usuarioActivo],
  );

  const resumen = React.useMemo(() => {
    const lineas: QuickReportLine[] = visibles.map((f) => ({
      quantity: Number(f.quantity),
      price: Number(f.price),
      customPrice: f.custom_price != null ? Number(f.custom_price) : null,
      cost: costoDeLinea(f),
      itbis: !!f.itbis,
      itbisIncluded: !!f.sales.itbis_included,
    }));
    return summarizeQuickLines(lineas, ITBIS_RATE);
  }, [visibles]);

  const mostrarSucursal = esAdmin && sucursalId === 'all';

  const columnasCsv = React.useMemo(
    () => [
      { header: 'Fecha', value: (f: FilaRapida) => new Date(f.sales.created_at).toLocaleString('es-DO') },
      { header: 'Venta', value: (f: FilaRapida) => ventaDeLinea(f) },
      { header: 'Usuario', value: (f: FilaRapida) => f.sales.user_name ?? '' },
      { header: 'Sucursal', value: (f: FilaRapida) => (f.sales.branch_id ? sucursales.get(f.sales.branch_id) ?? '' : '') },
      { header: 'Descripción', value: (f: FilaRapida) => f.product_name },
      { header: 'Cantidad', value: (f: FilaRapida) => Number(f.quantity) },
      { header: 'Precio', value: (f: FilaRapida) => precioUnitario(f) },
      // Vacío y no "—" para que Excel lo lea como número faltante, no como texto.
      { header: 'Costo', value: (f: FilaRapida) => costoDeLinea(f) ?? '' },
      { header: 'Total', value: (f: FilaRapida) => totalDeLinea(f) },
    ],
    [sucursales],
  );

  return (
    <div>
      <PageHeader title="Reporte de Ventas Rápidas">
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

          <Select value={usuarioActivo} onValueChange={setSelectedUser}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Usuario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los usuarios</SelectItem>
              {usuarios.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

          <ExportButton filename="ventas_rapidas" columns={columnasCsv} rows={visibles} />
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total vendido</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              {formatCurrency(resumen.total)}
            </div>
            <CardDescription className="mt-1">
              {visibles.length} línea{visibles.length === 1 ? '' : 's'}, con y sin costo
            </CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total con costo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-500" />
              {formatCurrency(resumen.totalWithCost)}
            </div>
            <CardDescription className="mt-1">Solo las líneas que traen costo</CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ganancia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              {formatCurrency(resumen.profit)}
            </div>
            <CardDescription className="mt-1">De las líneas con costo, sin ITBIS</CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sin costo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {formatCurrency(resumen.uncostedAmount)}
            </div>
            <CardDescription className="mt-1">
              {resumen.uncostedCount} línea{resumen.uncostedCount === 1 ? '' : 's'}, sin ganancia calculable
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle</CardTitle>
          <CardDescription>
            Cada línea es un artículo vendido fuera del inventario. Las ventas anuladas no aparecen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
            </div>
          ) : fallo ? (
            <p className="py-10 text-center text-sm text-destructive">
              No se pudo cargar el reporte. Intenta de nuevo en un momento.
            </p>
          ) : visibles.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay ventas rápidas en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Venta</TableHead>
                    <TableHead>Usuario</TableHead>
                    {mostrarSucursal && <TableHead>Sucursal</TableHead>}
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => {
                    const costo = costoDeLinea(f);
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(f.sales.created_at).toLocaleString('es-DO')}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{ventaDeLinea(f)}</TableCell>
                        <TableCell className="text-xs">{f.sales.user_name ?? '—'}</TableCell>
                        {mostrarSucursal && (
                          <TableCell className="text-xs">
                            {f.sales.branch_id ? sucursales.get(f.sales.branch_id) ?? '—' : '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-xs max-w-[240px]">{f.product_name}</TableCell>
                        <TableCell className="text-right text-xs">{formatQty(Number(f.quantity))}</TableCell>
                        <TableCell className="text-right text-xs">{formatCurrency(precioUnitario(f))}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {costo != null ? formatCurrency(costo) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(totalDeLinea(f))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={mostrarSucursal ? 8 : 7} className="font-bold">
                      Total vendido
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(resumen.total)}</TableCell>
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
