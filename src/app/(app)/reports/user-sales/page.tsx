'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon, Users, Loader2, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn, formatCurrency } from '@/lib/utils';
import { useUsers } from '@/context/user-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { ExportButton } from '@/components/reports/export-button';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  financing: 'Financiamiento',
};
const METHODS = Object.keys(METHOD_LABEL);

// Lo que necesita el reporte de cada venta. No usamos el provider de ventas
// porque solo carga la sucursal activa, y aquí el admin filtra por cualquiera.
type FilaVenta = {
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  branch_id: string | null;
  total: number | null;
  payment_method: string | null;
  cancelled_at: string | null;
  sale_items: { quantity: number | null; price: number | null; custom_price: number | null }[] | null;
};

type Resumen = {
  clave: string;
  nombre: string;
  email: string;
  ventas: number;
  ingresos: number;
  articulos: number;
  descuentos: number;
  anuladas: number;
  montoAnulado: number;
  porMetodo: Record<string, number>;
};

const cantidad = (n: number) =>
  n.toLocaleString('es-DO', { maximumFractionDigits: 2 });

export default function UserSalesReportPage() {
  const { users } = useUsers();
  const { branches } = useBranches();
  const { appUser } = useAuth();

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedBranch, setSelectedBranch] = React.useState('all');
  const [ventas, setVentas] = React.useState<FilaVenta[]>([]);
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
      let q = supabase
        .from('sales')
        .select('user_id,user_name,user_email,branch_id,total,payment_method,cancelled_at,sale_items(quantity,price,custom_price)')
        .gte('created_at', desdeIso)
        .lte('created_at', hastaIso);
      if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (cancelado) return;
      setVentas(error || !data ? [] : (data as unknown as FilaVenta[]));
      setLoading(false);
    };
    cargar();
    return () => { cancelado = true; };
  }, [desdeIso, hastaIso, selectedBranch]);

  // Nombre y correo de verdad, sacados del perfil. Las ventas viejas guardaron
  // el nombre de aquel momento y casi nunca el correo.
  const perfiles = React.useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    users.forEach((u) => map.set(u.id, { name: u.name, email: u.email }));
    return map;
  }, [users]);

  const resumen = React.useMemo(() => {
    const map = new Map<string, Resumen>();

    ventas.forEach((v) => {
      // La clave es el id del usuario. Agrupar por correo juntaba en una sola
      // fila a todos los vendedores de las ventas importadas del legacy, que lo
      // tienen vacío, y los mostraba con el nombre de la venta más reciente.
      const clave = v.user_id ?? `nombre:${v.user_name ?? 'desconocido'}`;
      const perfil = v.user_id ? perfiles.get(v.user_id) : undefined;

      const acc = map.get(clave) ?? {
        clave,
        nombre: perfil?.name || v.user_name || 'Usuario desconocido',
        email: perfil?.email || v.user_email || '—',
        ventas: 0, ingresos: 0, articulos: 0, descuentos: 0,
        anuladas: 0, montoAnulado: 0,
        porMetodo: Object.fromEntries(METHODS.map((m) => [m, 0])),
      };

      if (v.cancelled_at) {
        acc.anuladas += 1;
        acc.montoAnulado += Number(v.total ?? 0);
      } else {
        acc.ventas += 1;
        acc.ingresos += Number(v.total ?? 0);
        const metodo = v.payment_method ?? '';
        if (metodo in acc.porMetodo) acc.porMetodo[metodo] += Number(v.total ?? 0);
        (v.sale_items ?? []).forEach((it) => {
          const qty = Number(it.quantity ?? 0);
          acc.articulos += qty;
          const lista = Number(it.price ?? 0);
          const cobrado = it.custom_price == null ? lista : Number(it.custom_price);
          if (cobrado < lista) acc.descuentos += (lista - cobrado) * qty;
        });
      }

      map.set(clave, acc);
    });

    return Array.from(map.values()).sort((a, b) => b.ingresos - a.ingresos);
  }, [ventas, perfiles]);

  const totales = React.useMemo(() => {
    return resumen.reduce(
      (t, r) => ({
        ventas: t.ventas + r.ventas,
        ingresos: t.ingresos + r.ingresos,
        articulos: t.articulos + r.articulos,
        descuentos: t.descuentos + r.descuentos,
        anuladas: t.anuladas + r.anuladas,
        montoAnulado: t.montoAnulado + r.montoAnulado,
      }),
      { ventas: 0, ingresos: 0, articulos: 0, descuentos: 0, anuladas: 0, montoAnulado: 0 },
    );
  }, [resumen]);

  const porcentaje = (ingresos: number) =>
    totales.ingresos > 0 ? (ingresos / totales.ingresos) * 100 : 0;
  const ticketPromedio = (r: Resumen) => (r.ventas > 0 ? r.ingresos / r.ventas : 0);

  return (
    <div>
      <PageHeader title="Reporte de Ventas por Usuario">
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
                id="rango"
                variant="outline"
                className={cn('w-[260px] justify-start text-left font-normal', !date && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'd LLL y', { locale: es })} – {format(date.to, 'd LLL y', { locale: es })}
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

          <ExportButton
            filename="ventas_por_usuario"
            rows={resumen}
            columns={[
              { header: 'Usuario', value: (r) => r.nombre },
              { header: 'Email', value: (r) => r.email },
              { header: 'Ventas realizadas', value: (r) => r.ventas },
              { header: 'Ingresos', value: (r) => r.ingresos },
              { header: 'Ticket promedio', value: (r) => ticketPromedio(r) },
              { header: 'Articulos', value: (r) => r.articulos },
              { header: 'Descuentos', value: (r) => r.descuentos },
              { header: '% del total', value: (r) => porcentaje(r.ingresos) },
              { header: 'Anuladas', value: (r) => r.anuladas },
              { header: 'Monto anulado', value: (r) => r.montoAnulado },
              ...METHODS.map((m) => ({ header: METHOD_LABEL[m], value: (r: Resumen) => r.porMetodo[m] })),
            ]}
          />
        </div>
      </PageHeader>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <span>Desglose de Ventas por Cajero/Vendedor</span>
            </CardTitle>
            <CardDescription>
              Las ventas anuladas no cuentan en ingresos, artículos ni descuentos; van en su propia columna.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Ingresos</TableHead>
                    <TableHead className="text-right">Ticket prom.</TableHead>
                    <TableHead className="text-right">Artículos</TableHead>
                    <TableHead className="text-right">Descuentos</TableHead>
                    <TableHead className="text-right">% del total</TableHead>
                    <TableHead className="text-right">Anuladas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-24 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : resumen.length > 0 ? (
                    resumen.map((r) => (
                      <TableRow key={r.clave}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback>{r.nombre.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{r.nombre}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.email}</TableCell>
                        <TableCell className="text-right font-bold">{r.ventas}</TableCell>
                        <TableCell className="text-right">{formatCurrency(r.ingresos)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(ticketPromedio(r))}</TableCell>
                        <TableCell className="text-right">{cantidad(r.articulos)}</TableCell>
                        <TableCell className="text-right">
                          {r.descuentos > 0 ? formatCurrency(r.descuentos) : '—'}
                        </TableCell>
                        <TableCell className="text-right">{porcentaje(r.ingresos).toFixed(1)}%</TableCell>
                        <TableCell className="text-right">
                          {r.anuladas > 0 ? (
                            <span className="text-destructive">
                              {r.anuladas} ({formatCurrency(r.montoAnulado)})
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="h-24 text-center">
                        No hay ventas en este rango de fechas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                {!loading && resumen.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell className="text-right font-bold">{totales.ventas}</TableCell>
                      <TableCell className="text-right">{formatCurrency(totales.ingresos)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(totales.ventas > 0 ? totales.ingresos / totales.ventas : 0)}
                      </TableCell>
                      <TableCell className="text-right">{cantidad(totales.articulos)}</TableCell>
                      <TableCell className="text-right">
                        {totales.descuentos > 0 ? formatCurrency(totales.descuentos) : '—'}
                      </TableCell>
                      <TableCell className="text-right">100%</TableCell>
                      <TableCell className="text-right">
                        {totales.anuladas > 0
                          ? `${totales.anuladas} (${formatCurrency(totales.montoAnulado)})`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              <span>Cómo cobró cada uno</span>
            </CardTitle>
            <CardDescription>
              Ingresos por forma de cobro. Crédito y financiamiento son la venta completa, no lo abonado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    {METHODS.map((m) => (
                      <TableHead key={m} className="text-right">{METHOD_LABEL[m]}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!loading && resumen.length > 0 ? (
                    resumen.map((r) => (
                      <TableRow key={r.clave}>
                        <TableCell className="font-medium">{r.nombre}</TableCell>
                        {METHODS.map((m) => (
                          <TableCell key={m} className="text-right">
                            {r.porMetodo[m] > 0 ? formatCurrency(r.porMetodo[m]) : '—'}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-bold">{formatCurrency(r.ingresos)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={METHODS.length + 2} className="h-24 text-center">
                        {loading ? (
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          'No hay ventas en este rango de fechas.'
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
