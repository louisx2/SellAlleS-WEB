'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Search, Zap, AlertTriangle, BarChart3, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { rowToService, SERVICE_SELECT } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { useRealtimeReload } from '@/lib/use-realtime-reload';
import { caseNumber, daysInShop, equipmentLabel, isLate, isOpen, isReadyToDeliver, SERVICE_STATUS, STATUS_ORDER } from '@/lib/taller';
import type { Service } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { useAuth } from '@/context/auth-provider';
import { useSharing } from '@/context/sharing-provider';
import { StatusBadge } from '@/components/taller/status-badge';
import { useTallerConfig } from '@/components/taller/use-taller-config';

type Vista = 'activos' | 'listos' | 'entregados' | 'todos';
const TODOS = 'all';
const MIOS = 'mine';
const SIN_ASIGNAR = 'none';

// Casos cerrados que se traen: los entregados/cancelados de los últimos 120 días.
// Los abiertos se traen siempre, por viejos que sean.
const DIAS_CERRADOS = 120;

export default function TallerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { appUser } = useAuth();
  const { technicians } = useTallerConfig();
  const { branchesFor, loading: sharingLoading } = useSharing();
  const canCreate = usePermission('services', 'create');
  const seesAll = usePermission('services-all', 'view');
  const canReports = usePermission('reports', 'view');

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('activos');
  const [search, setSearch] = useState('');
  const [tech, setTech] = useState<string>(TODOS);
  const [status, setStatus] = useState<string>(TODOS);

  // services.branch_id es NOT NULL: el pool de 'servicios' decide de qué sucursales.
  const branchesKey = branchesFor('servicios').join(',');

  const load = useCallback(async () => {
    if (sharingLoading) return;
    const branchIds = branchesKey.split(',').filter(Boolean);
    if (branchIds.length === 0) { setServices([]); setLoading(false); return; }
    const desde = new Date(Date.now() - DIAS_CERRADOS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('services')
      .select(SERVICE_SELECT)
      .in('branch_id', branchIds)
      .or(`status.not.in.(delivered,cancelled),created_at.gte.${desde}`)
      .order('created_at', { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      console.error(error);
      toast({ title: 'No se pudieron cargar los casos', description: error.message, variant: 'destructive' });
      return;
    }
    setServices((data ?? []).map(rowToService));
  }, [toast, sharingLoading, branchesKey]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload('services', load);

  const counts = useMemo(() => ({
    activos: services.filter((s) => isOpen(s.status) && !isReadyToDeliver(s.status)).length,
    listos: services.filter((s) => isReadyToDeliver(s.status)).length,
    entregados: services.filter((s) => s.status === 'delivered').length,
    todos: services.length,
  }), [services]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (vista === 'activos' && !(isOpen(s.status) && !isReadyToDeliver(s.status))) return false;
      if (vista === 'listos' && !isReadyToDeliver(s.status)) return false;
      if (vista === 'entregados' && s.status !== 'delivered') return false;
      if (status !== TODOS && s.status !== status) return false;
      if (tech === MIOS && s.assignedTo !== appUser?.id) return false;
      if (tech === SIN_ASIGNAR && s.assignedTo) return false;
      if (tech !== TODOS && tech !== MIOS && tech !== SIN_ASIGNAR && s.assignedTo !== tech) return false;
      if (!q) return true;
      const haystack = [
        caseNumber(s.number), String(s.number), s.customer?.name, s.customer?.phone, s.broughtByName,
        s.equipmentBrand, s.equipmentModel, s.equipmentSerial, s.description,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [services, vista, status, tech, search, appUser?.id]);

  const open = (s: Service) => router.push(`/services/caso?id=${s.id}`);

  return (
    <div>
      <PageHeader title="Taller">
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            {canReports && (
              <Button variant="ghost" asChild>
                <Link href="/reports/taller"><BarChart3 className="mr-2 h-4 w-4" />Reportes</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/services/nuevo?modo=rapida"><Zap className="mr-2 h-4 w-4" />Reparación rápida</Link>
            </Button>
            <Button asChild>
              <Link href="/services/nuevo"><PlusCircle className="mr-2 h-4 w-4" />Nuevo ingreso</Link>
            </Button>
          </div>
        )}
      </PageHeader>

      {!seesAll && (
        <p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Ves los casos asignados a ti, los que recibiste y los que están sin asignar.
        </p>
      )}

      <div className="mb-3 overflow-x-auto pb-1">
        <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)}>
          <TabsList>
            <TabsTrigger value="activos">En el taller ({counts.activos})</TabsTrigger>
            <TabsTrigger value="listos">Listos ({counts.listos})</TabsTrigger>
            <TabsTrigger value="entregados">Entregados ({counts.entregados})</TabsTrigger>
            <TabsTrigger value="todos">Todos ({counts.todos})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, cliente, teléfono, equipo o IMEI"
            className="pl-8"
            aria-label="Buscar casos"
          />
        </div>
        <Select value={tech} onValueChange={setTech}>
          <SelectTrigger className="sm:w-48" aria-label="Filtrar por técnico"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los técnicos</SelectItem>
            <SelectItem value={MIOS}>Mis casos</SelectItem>
            <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
            {technicians.map((t) => <SelectItem key={t.profileId} value={t.profileId}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{SERVICE_STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : shown.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {services.length === 0
            ? 'Todavía no hay casos. Ingresa el primero con «Nuevo ingreso».'
            : 'Ningún caso coincide con la búsqueda o los filtros.'}
        </div>
      ) : (
        <>
          {/* Teléfono: tarjetas */}
          <div className="space-y-2 md:hidden">
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => open(s)}
                className="w-full rounded-md border bg-card p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {caseNumber(s.number)} · {s.customer?.name ?? s.broughtByName ?? 'Consumidor final'}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {equipmentLabel(s) || 'Equipo'} — {s.description}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{s.assignedUser?.name ?? 'Sin asignar'}</span>
                  <span>{daysInShop(s)} d</span>
                  <span className="font-medium text-foreground">{formatCurrency(s.total)}</span>
                  {s.paymentStatus === 'paid' ? <span>Cobrado</span> : s.total > 0 ? <span>Por cobrar</span> : null}
                  {isLate(s) && <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-3 w-3" />Atrasado</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Pantalla ancha: tabla */}
          <div className="hidden rounded-md border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Caso</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Equipo y falla</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Técnico</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => open(s)}>
                    <TableCell className="font-medium">
                      <Link href={`/services/caso?id=${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {caseNumber(s.number)}
                      </Link>
                      {s.isQuick && <span className="ml-1 text-xs text-muted-foreground" title="Reparación rápida">⚡</span>}
                      {(s.warrantyOfServiceId || s.warrantySaleId) && (
                        <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-sky-600" aria-label="Garantía" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{s.customer?.name ?? s.broughtByName ?? 'Consumidor final'}</div>
                      {(s.customer?.phone || s.broughtByPhone) && (
                        <div className="text-xs text-muted-foreground">{s.customer?.phone || s.broughtByPhone}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[20rem]">
                      <div className="truncate">{equipmentLabel(s) || '—'}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.description}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={s.status} />
                        {isLate(s) && (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />Atrasado</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{s.assignedUser?.name ?? <span className="text-muted-foreground">Sin asignar</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{daysInShop(s)}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium tabular-nums">{formatCurrency(s.total)}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.paymentStatus === 'paid' ? 'Cobrado' : s.total > 0 ? 'Por cobrar' : ''}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
