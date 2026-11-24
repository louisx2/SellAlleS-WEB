'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCobranza, useCuentasDeCobro } from '@/hooks/use-cobranza';
import { formatCurrency } from '@/lib/utils';

type Atraso = 'todos' | 'atrasados' | 'mas30';
const SIN_ZONA = '__sin_zona__';

// Asignar cartera: los clientes con cuentas abiertas en la sucursal, con su
// cobrador y orden de visita. Se eligen varios y se asignan o se quitan.
export default function AsignarCarteraPage() {
  const { toast } = useToast();
  const { cobradores, asignaciones, asignar, quitarAsignacion, ordenar, loading: cargandoCartera } = useCobranza();
  const { cuentas, clientes, loading: cargandoCuentas } = useCuentasDeCobro();
  const loading = cargandoCartera || cargandoCuentas;
  const [q, setQ] = useState('');
  const [zona, setZona] = useState('todas');
  const [atraso, setAtraso] = useState<Atraso>('todos');
  const [soloSinAsignar, setSoloSinAsignar] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState('');
  const [busy, setBusy] = useState(false);

  const filas = useMemo(() => {
    const porCliente = new Map<string, { pendiente: number; diasAtraso: number; cuentas: number }>();
    for (const c of cuentas) {
      const f = porCliente.get(c.customerId) ?? { pendiente: 0, diasAtraso: 0, cuentas: 0 };
      f.pendiente += c.pendiente;
      f.diasAtraso = Math.max(f.diasAtraso, c.diasAtraso);
      f.cuentas += 1;
      porCliente.set(c.customerId, f);
    }
    return [...porCliente.entries()].map(([customerId, f]) => {
      const cliente = clientes.get(customerId);
      const asignacion = asignaciones.find((a) => a.customerId === customerId);
      return {
        customerId, ...f,
        nombre: cliente?.name ?? 'Cliente',
        apodo: cliente?.nickname,
        zona: cliente?.zone?.trim() || '',
        asignacion,
        cobrador: cobradores.find((c) => c.id === asignacion?.collectorId)?.name,
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [cuentas, clientes, asignaciones, cobradores]);

  const zonas = useMemo(() => [...new Set(filas.map((f) => f.zona).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [filas]);

  const visibles = filas.filter((f) => {
    if (soloSinAsignar && f.asignacion) return false;
    if (zona === SIN_ZONA ? f.zona !== '' : zona !== 'todas' && f.zona !== zona) return false;
    if (atraso === 'atrasados' && f.diasAtraso === 0) return false;
    if (atraso === 'mas30' && f.diasAtraso <= 30) return false;
    const t = q.trim().toLowerCase();
    return !t || f.nombre.toLowerCase().includes(t) || (f.apodo ?? '').toLowerCase().includes(t);
  });

  const marcar = (id: string, on: boolean) => setSeleccion((s) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });
  const todosMarcados = visibles.length > 0 && visibles.every((f) => seleccion.has(f.customerId));

  const correr = async (accion: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await accion();
      toast({ title: ok });
      setSeleccion(new Set());
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const cambiarOrden = async (customerId: string, texto: string, actual: number) => {
    const n = Number(texto);
    if (!Number.isFinite(n) || n === actual) return;
    try {
      await ordenar(customerId, n);
    } catch (e: any) {
      toast({ title: 'No se pudo cambiar el orden', description: e?.message, variant: 'destructive' });
    }
  };

  const activos = cobradores.filter((c) => c.isActive);

  return (
    <div>
      <PageHeader title="Asignar cartera" />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar cliente o apodo" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={zona} onValueChange={setZona}>
              <SelectTrigger className="w-44" aria-label="Zona"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las zonas</SelectItem>
                <SelectItem value={SIN_ZONA}>Sin zona</SelectItem>
                {zonas.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={atraso} onValueChange={(v) => setAtraso(v as Atraso)}>
              <SelectTrigger className="w-44" aria-label="Atraso"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Con o sin atraso</SelectItem>
                <SelectItem value="atrasados">Atrasados</SelectItem>
                <SelectItem value="mas30">Más de 30 días</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={soloSinAsignar} onCheckedChange={(v) => setSoloSinAsignar(v === true)} /> Solo sin asignar
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{seleccion.size} {seleccion.size === 1 ? 'cliente elegido' : 'clientes elegidos'}</span>
            <Select value={destino} onValueChange={setDestino}>
              <SelectTrigger className="w-56" aria-label="Cobrador"><SelectValue placeholder="Cobrador" /></SelectTrigger>
              <SelectContent>
                {activos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={busy || seleccion.size === 0 || !destino}
              onClick={() => correr(() => asignar([...seleccion], destino), 'Cartera asignada')}>Asignar</Button>
            <Button variant="outline" disabled={busy || seleccion.size === 0}
              onClick={() => correr(() => quitarAsignacion([...seleccion]), 'Asignación quitada')}>Quitar cobrador</Button>
          </div>
          {activos.length === 0 && !loading && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              No hay cobradores en esta sucursal. Márcalos en Configuración de Motopréstamos → Cobradores.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox aria-label="Elegir todos" checked={todosMarcados}
                    onCheckedChange={(v) => setSeleccion(v === true ? new Set(visibles.map((f) => f.customerId)) : new Set())} />
                </TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Debe</TableHead>
                <TableHead className="text-right">Atraso</TableHead>
                <TableHead>Cobrador</TableHead>
                <TableHead className="w-24">Orden</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {loading ? 'Cargando…' : 'Ningún cliente con cuentas abiertas con estos filtros.'}
                </TableCell></TableRow>
              )}
              {visibles.map((f) => (
                <TableRow key={f.customerId}>
                  <TableCell>
                    <Checkbox aria-label={`Elegir a ${f.nombre}`} checked={seleccion.has(f.customerId)}
                      onCheckedChange={(v) => marcar(f.customerId, v === true)} />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{f.nombre}{f.apodo && <span className="font-normal text-muted-foreground"> «{f.apodo}»</span>}</p>
                    <p className="text-xs text-muted-foreground">{f.zona || 'Sin zona'} · {f.cuentas} {f.cuentas === 1 ? 'cuenta' : 'cuentas'}</p>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(f.pendiente)}</TableCell>
                  <TableCell className="text-right">{f.diasAtraso > 0 ? `${f.diasAtraso} d` : '—'}</TableCell>
                  <TableCell>{f.cobrador ?? <span className="text-muted-foreground">Sin asignar</span>}</TableCell>
                  <TableCell>
                    {f.asignacion && (
                      <Input key={`${f.customerId}-${f.asignacion.orden}`} type="number" min={0} className="h-8 w-20"
                        defaultValue={f.asignacion.orden} aria-label={`Orden de visita de ${f.nombre}`}
                        onBlur={(e) => cambiarOrden(f.customerId, e.target.value, f.asignacion!.orden)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
