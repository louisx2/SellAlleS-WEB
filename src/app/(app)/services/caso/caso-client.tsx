'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Ban, CheckCircle2, Eye, EyeOff, HandCoins, Link2, MessageCircle, Pencil, Printer, RotateCcw, ShieldCheck,
  Trash, UserCheck, Users, Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { useAuth } from '@/context/auth-provider';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { supabase } from '@/lib/supabase/client';
import { rowToService, rowToServiceEvent, rowToServiceItem, SERVICE_SELECT } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity } from '@/lib/units';
import { useRealtimeReload } from '@/lib/use-realtime-reload';
import {
  ANSWER_LABEL, caseNumber, daysInShop, equipmentLabel, isLate, isOpen, isReadyToDeliver,
  fmtDate, MANUAL_STATUSES, mensajeDeEstado, SERVICE_STATUS, trackingUrl, warrantyActive, whatsappPhone,
} from '@/lib/taller';
import type { Product, Service, ServiceEvent, ServiceItem, ServiceStatus } from '@/lib/types';
import { StatusBadge } from '@/components/taller/status-badge';
import { useTallerConfig } from '@/components/taller/use-taller-config';
import { PartPicker } from '@/components/taller/part-picker';
import { Historial } from '@/components/taller/historial';
import { ReciboRecepcionDialog } from '@/components/taller/recibo-recepcion';
import { abrirCobroDelCaso } from '@/components/taller/cobrar';
import { FotosDelCaso } from '@/components/taller/fotos';

const NINGUNO = 'none';
const fecha = (d?: Date) => (d ? d.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function Dato({ k, v, children }: { k: string; v?: string | null; children?: React.ReactNode }) {
  if (!v && !children) return null;
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words">{children ?? v}</span>
    </div>
  );
}

export default function CasoClient() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const { toast } = useToast();
  const { appUser } = useAuth();
  const config = useTallerConfig();
  const canEdit = usePermission('services', 'edit');
  const canCancel = usePermission('services', 'delete');
  const canCreate = usePermission('services', 'create');

  const [service, setService] = useState<Service | null>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const [reciboOpen, setReciboOpen] = useState(params.get('recibo') === '1');
  const [statusDialog, setStatusDialog] = useState<ServiceStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [statusVisible, setStatusVisible] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState<string>(NINGUNO);
  const [assignNote, setAssignNote] = useState('');
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [pickedUpBy, setPickedUpBy] = useState('');
  const [deliverNote, setDeliverNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [origen, setOrigen] = useState<{ id: string; number: number } | null>(null);

  const load = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    const [srv, its, evs] = await Promise.all([
      supabase.from('services').select(SERVICE_SELECT).eq('id', id).maybeSingle(),
      supabase.from('service_items').select('*, products(*)').eq('service_id', id).order('created_at'),
      supabase.from('service_events').select('*').eq('service_id', id).order('created_at'),
    ]);
    setLoading(false);
    if (!srv.data) { setNotFound(true); return; }
    const s = rowToService(srv.data);
    setService(s);
    if (s.warrantyOfServiceId) {
      const { data: o } = await supabase.from('services').select('id, number').eq('id', s.warrantyOfServiceId).maybeSingle();
      setOrigen(o ? { id: o.id, number: Number(o.number) } : null);
    }
    setDiagnosis(s.diagnosis ?? '');
    setItems((its.data ?? []).map(rowToServiceItem));
    const evList = (evs.data ?? []).map(rowToServiceEvent);
    setEvents(evList);
    // Nombres de los usuarios que aparecen en el historial (de/para en asignaciones).
    const ids = Array.from(new Set(evList.flatMap((e) => [e.fromUser, e.toUser]).filter(Boolean))) as string[];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id, name').in('id', ids);
      setNames(Object.fromEntries((data ?? []).map((p: any) => [p.id, p.name ?? 'Sin nombre'])));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload('services', load);

  const profile = useTicketProfile(service?.branchName);
  const equipmentType = config.equipmentTypes.find((t) => t.id === service?.equipmentTypeId);
  const labor = items.filter((i) => i.kind === 'labor');
  const parts = items.filter((i) => i.kind === 'part');
  const editable = !!service && isOpen(service.status) && service.paymentStatus !== 'paid' && canEdit;
  // Reingreso por garantía: lo que se agrega entra en 0 (se puede cambiar).
  const esGarantia = !!service && !!(service.warrantyOfServiceId || service.warrantySaleId);
  const isTech = config.technicians.some((t) => t.profileId === appUser?.id);
  const catalog = config.catalog.filter((s) => s.isActive && s.productId
    && (!s.equipmentTypeId || !service?.equipmentTypeId || s.equipmentTypeId === service.equipmentTypeId));
  const suggestedCategory = useMemo(() => {
    const ids = new Set(labor.map((l) => l.serviceTypeId));
    return config.catalog.find((s) => ids.has(s.id) && s.partCategoryId)?.partCategoryId;
  }, [labor, config.catalog]);

  const fail = (title: string, error?: { message: string } | null) => {
    toast({ title, description: error?.message, variant: 'destructive' });
  };

  // ---- acciones ----
  const changeStatus = async () => {
    if (!service || !statusDialog) return;
    setBusy(true);
    const { error } = await supabase.rpc('taller_cambiar_estado', {
      p_service_id: service.id, p_status: statusDialog, p_note: statusNote.trim() || null, p_visible: statusVisible,
    });
    setBusy(false);
    if (error) return fail('No se pudo cambiar el estado', error);
    setStatusDialog(null); setStatusNote(''); setStatusVisible(false);
    toast({ title: `Ahora: ${SERVICE_STATUS[statusDialog].label}` });
    load();
  };

  const assign = async (profileId: string | null, note?: string) => {
    if (!service) return;
    setBusy(true);
    const { error } = await supabase.rpc('taller_asignar', {
      p_service_id: service.id, p_profile_id: profileId, p_note: note?.trim() || null,
    });
    setBusy(false);
    if (error) return fail('No se pudo asignar', error);
    setAssignOpen(false); setAssignNote('');
    toast({ title: profileId ? 'Caso asignado' : 'Caso sin asignar' });
    // Si se lo pasó a otro y no ve todos, deja de verlo: de vuelta a la lista.
    const { data } = await supabase.from('services').select('id').eq('id', service.id).maybeSingle();
    if (!data) { router.push('/services'); return; }
    load();
  };

  const cobrar = async () => {
    if (!service) return;
    setBusy(true);
    const r = await abrirCobroDelCaso(service);
    setBusy(false);
    if (!r.ok) return fail('No se pudo abrir el cobro', { message: r.error });
    router.push('/pos');
  };

  const deliver = async () => {
    if (!service) return;
    setBusy(true);
    const { error } = await supabase.rpc('taller_entregar', {
      p_service_id: service.id, p_picked_up_by: pickedUpBy.trim() || null, p_note: deliverNote.trim() || null,
    });
    setBusy(false);
    if (error) return fail('No se pudo entregar', error);
    setDeliverOpen(false);
    toast({ title: 'Caso entregado' });
    load();
  };

  const cancel = async () => {
    if (!service) return;
    setBusy(true);
    const { error } = await supabase.rpc('taller_cambiar_estado', {
      p_service_id: service.id, p_status: 'cancelled', p_note: cancelNote.trim() || null, p_visible: false,
    });
    setBusy(false);
    if (error) return fail('No se pudo cancelar', error);
    setCancelOpen(false);
    toast({ title: 'Caso cancelado', description: parts.length ? 'Las piezas volvieron al inventario.' : undefined });
    load();
  };

  const addNote = async (note: string, visible: boolean) => {
    if (!service) return false;
    const { error } = await supabase.rpc('taller_nota', { p_service_id: service.id, p_note: note, p_visible: visible });
    if (error) { fail('No se pudo guardar la nota', error); return false; }
    load();
    return true;
  };

  const saveDiagnosis = async () => {
    if (!service) return;
    const { error } = await supabase.from('services').update({ diagnosis: diagnosis.trim() || null }).eq('id', service.id);
    if (error) return fail('No se pudo guardar el diagnóstico', error);
    toast({ title: 'Diagnóstico guardado' });
    load();
  };

  const addLabor = async (serviceTypeId: string) => {
    const st = catalog.find((s) => s.id === serviceTypeId);
    if (!service || !st?.productId) return;
    const { error } = await supabase.from('service_items').insert({
      service_id: service.id, product_id: st.productId, quantity: 1, price: esGarantia ? 0 : st.price, kind: 'labor', service_type_id: st.id,
    });
    if (error) return fail('No se pudo agregar el servicio', error);
    load();
  };

  const addPart = async (p: Product) => {
    if (!service) return;
    const { error } = await supabase.from('service_items').insert({
      service_id: service.id, product_id: p.id, quantity: 1, price: esGarantia ? 0 : p.price, kind: 'part',
    });
    if (error) return fail('No se pudo agregar la pieza', error);
    setAddingPart(false);
    load();
  };

  const updateLine = async (line: ServiceItem, patch: { quantity?: number; price?: number }) => {
    const { error } = await supabase.from('service_items').update(patch).eq('id', line.id);
    if (error) { fail('No se pudo cambiar la línea', error); load(); return; }
    load();
  };

  const removeLine = async (line: ServiceItem) => {
    if (!confirm(line.kind === 'part' ? `¿Quitar «${line.product.name}»? Vuelve al inventario.` : `¿Quitar «${line.product.name}»?`)) return;
    const { error } = await supabase.from('service_items').delete().eq('id', line.id);
    if (error) return fail('No se pudo quitar la línea', error);
    load();
  };

  // ---- render ----
  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }
  if (notFound || !service) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild><Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Taller</Link></Button>
        <p className="text-sm text-muted-foreground">No se encontró el caso, o no tienes acceso a él.</p>
      </div>
    );
  }

  const phone = service.customer?.phone || service.broughtByPhone;
  const contactName = service.customer?.name ?? service.broughtByName;
  const waPhone = whatsappPhone(phone);
  const enlace = typeof window !== 'undefined' && service.trackingCode ? trackingUrl(service.trackingCode, window.location.origin) : undefined;
  const copiarEnlace = async () => {
    if (!enlace) return;
    try { await navigator.clipboard.writeText(enlace); toast({ title: 'Enlace copiado', description: 'Pégalo en el chat del cliente.' }); }
    catch { toast({ title: 'No se pudo copiar', description: enlace }); }
  };
  const unpaid = service.total > 0 && service.paymentStatus !== 'paid';
  const open = isOpen(service.status);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-2">
        <Button variant="ghost" size="sm" asChild><Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Taller</Link></Button>
      </div>

      {/* Cabecera */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Caso {caseNumber(service.number)}</h1>
            <StatusBadge status={service.status} />
            {service.isQuick && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Zap className="h-3 w-3" />Rápida</span>}
            {isLate(service) && <span className="text-xs font-medium text-destructive">Atrasado</span>}
          </div>
          <p className="text-sm text-muted-foreground">
            {equipmentLabel(service) || 'Equipo'} · {contactName ?? 'Consumidor final'} · {daysInShop(service)} días en el taller
          </p>
          {esGarantia && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-900/60 dark:text-sky-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reingreso por garantía
              {origen && <> del <Link className="underline" href={`/services/caso?id=${origen.id}`}>caso {caseNumber(origen.number)}</Link></>}
              {service.warrantySaleId && <> de <Link className="underline" href={`/sales/detail?id=${service.warrantySaleId}`}>una venta</Link></>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {waPhone && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(mensajeDeEstado(service, contactName, profile.name, enlace))}`}
                target="_blank" rel="noopener noreferrer"
              >
                <MessageCircle className="mr-1 h-4 w-4" />Avisar
              </a>
            </Button>
          )}
          {enlace && (
            <Button variant="outline" size="sm" onClick={copiarEnlace} title="Enlace para que el cliente vea cómo va su equipo">
              <Link2 className="mr-1 h-4 w-4" />Enlace
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setReciboOpen(true)}><Printer className="mr-1 h-4 w-4" />Recibo</Button>
          {open && canEdit && unpaid && items.length > 0 && (
            <Button size="sm" onClick={cobrar} disabled={busy}><HandCoins className="mr-1 h-4 w-4" />Cobrar {formatCurrency(service.total)}</Button>
          )}
          {isReadyToDeliver(service.status) && canEdit && !unpaid && (
            <Button size="sm" onClick={() => { setPickedUpBy(contactName ?? ''); setDeliverOpen(true); }} disabled={busy}>
              <CheckCircle2 className="mr-1 h-4 w-4" />Entregar
            </Button>
          )}
        </div>
      </div>

      {/* Estado y técnico */}
      {open && canEdit && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="st">Estado</Label>
              <Select value={service.status} onValueChange={(v) => { if (v !== service.status) setStatusDialog(v as ServiceStatus); }}>
                <SelectTrigger id="st" className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{SERVICE_STATUS[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Técnico</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{service.assignedUser?.name ?? 'Sin asignar'}</span>
                {!service.assignedTo && isTech && (
                  <Button variant="outline" size="sm" onClick={() => assign(appUser!.id, 'Tomó el caso')} disabled={busy}>
                    <UserCheck className="mr-1 h-4 w-4" />Tomar el caso
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setAssignTo(service.assignedTo ?? NINGUNO); setAssignOpen(true); }}>
                  <Users className="mr-1 h-4 w-4" />{service.assignedTo ? 'Pasar a otro técnico' : 'Asignar'}
                </Button>
              </div>
            </div>
            {canCancel && !service.saleId && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="mr-1 h-4 w-4" />Cancelar caso
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {isReadyToDeliver(service.status) && unpaid && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Está listo, pero falta cobrarlo: {formatCurrency(service.total)}. Después de cobrar en el POS, vuelve aquí para entregarlo.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Líneas */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Servicios y piezas</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay nada que cobrar.</p>}
              {[...labor, ...parts].map((line) => (
                <div key={line.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{line.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.kind === 'labor' ? 'Mano de obra' : `Pieza${line.product.tracksStock ? ` · quedan ${formatQuantity(line.product.stock, line.product.unit)}` : ''}`}
                    </p>
                  </div>
                  {editable ? (
                    <>
                      {line.kind === 'part' && (
                        <Input
                          type="number" min={1} step={1} defaultValue={line.quantity} key={`q-${line.id}-${line.quantity}`}
                          onBlur={(e) => {
                            const q = Math.floor(Number(e.target.value));
                            if (q >= 1 && q !== line.quantity) updateLine(line, { quantity: q });
                          }}
                          className="h-8 w-16" aria-label={`Cantidad de ${line.product.name}`}
                        />
                      )}
                      <Input
                        inputMode="decimal" defaultValue={line.price} key={`p-${line.id}-${line.price}`}
                        onBlur={(e) => {
                          const p = Math.round(Number(e.target.value) * 100) / 100;
                          if (Number.isFinite(p) && p >= 0 && p !== line.price) updateLine(line, { price: p });
                        }}
                        className="h-8 w-24 text-right" aria-label={`Precio de ${line.product.name}`}
                      />
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">{line.quantity} × {formatCurrency(line.price)}</span>
                  )}
                  <span className="w-24 text-right text-sm font-medium tabular-nums">{formatCurrency(line.price * line.quantity)}</span>
                  {editable && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Quitar ${line.product.name}`} onClick={() => removeLine(line)}>
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              {editable && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value="" onValueChange={addLabor}>
                    <SelectTrigger aria-label="Agregar servicio"><SelectValue placeholder="+ Agregar servicio del catálogo" /></SelectTrigger>
                    <SelectContent>
                      {catalog.length === 0
                        ? <div className="p-2 text-sm text-muted-foreground">El catálogo está vacío.</div>
                        : catalog.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {formatCurrency(s.price)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {addingPart ? (
                    <PartPicker
                      autoFocus
                      branchId={service.branchId}
                      locationId={config.settings?.partsLocationId}
                      suggestedCategoryId={suggestedCategory}
                      onPick={addPart}
                    />
                  ) : (
                    <Button variant="outline" onClick={() => setAddingPart(true)}>+ Agregar pieza</Button>
                  )}
                </div>
              )}

              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Mano de obra</span><span className="tabular-nums">{formatCurrency(service.laborPrice)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Piezas</span><span className="tabular-nums">{formatCurrency(service.partsTotal)}</span></div>
                <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(service.total)}</span></div>
                <p className="text-xs text-muted-foreground">
                  {service.paymentStatus === 'paid' && service.saleId
                    ? <>Cobrado · <Link className="underline" href={`/sales/detail?id=${service.saleId}`}>ver la venta</Link></>
                    : service.total > 0 ? 'Por cobrar. El ITBIS, si aplica, se suma al cobrar.' : ''}
                  {service.estimate != null && ` · Presupuesto aprox. ${formatCurrency(service.estimate)}`}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Diagnóstico */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Diagnóstico</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm"><span className="text-muted-foreground">Falla reportada: </span>{service.description}</p>
              {canEdit && open ? (
                <>
                  <Textarea aria-label="Diagnóstico" rows={3} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Lo que encontró el técnico" />
                  {diagnosis !== (service.diagnosis ?? '') && (
                    <div className="flex justify-end"><Button size="sm" onClick={saveDiagnosis}>Guardar diagnóstico</Button></div>
                  )}
                </>
              ) : (
                service.diagnosis && <p className="text-sm whitespace-pre-line">{service.diagnosis}</p>
              )}
            </CardContent>
          </Card>

          {/* Historial */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Historial</CardTitle></CardHeader>
            <CardContent>
              <Historial events={events} names={names} canNote={canEdit} onNote={addNote} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Ficha */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Ficha</CardTitle>
              {canEdit && open && (
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar ficha" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /></Button>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Dato k="Cliente" v={service.customer?.name ?? 'Consumidor final'} />
              <Dato k="Teléfono" v={phone ?? undefined}>{phone ? <a className="underline" href={`tel:${phone}`}>{phone}</a> : undefined}</Dato>
              <Dato k="Lo trajo" v={service.broughtByName && service.customer ? [service.broughtByName, service.broughtByPhone].filter(Boolean).join(' · ') : undefined} />
              <Dato k="Equipo" v={[equipmentType?.name, equipmentLabel(service)].filter(Boolean).join(' · ') || undefined} />
              <Dato k={equipmentType?.serialLabel ?? 'Serie'} v={service.equipmentSerial} />
              {service.equipmentPassword && (
                <Dato k="Clave/patrón">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">{showPassword ? service.equipmentPassword : '••••••'}</span>
                    <button type="button" aria-label={showPassword ? 'Ocultar clave' : 'Ver clave'} onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                </Dato>
              )}
              {equipmentType?.extraFields.map((f) => <Dato key={f.key} k={f.label} v={service.equipmentDetails[f.key]} />)}
              <Dato k="Dejó" v={service.accessories} />
              <Dato k="Prometido para" v={service.promisedAt?.toLocaleDateString('es-DO')} />
              <div className="my-2 border-t" />
              <Dato k="Recibió" v={`${service.receivedByName ?? '—'} · ${fecha(service.createdAt)}`} />
              {service.readyAt && <Dato k="Listo" v={fecha(service.readyAt)} />}
              {service.deliveredAt && <Dato k="Entregó" v={`${service.deliveredByName ?? '—'} · ${fecha(service.deliveredAt)}`} />}
              <Dato k="Retiró" v={service.pickedUpByName} />
            </CardContent>
          </Card>

          {service.status === 'delivered' && (service.warrantyUntil || canCreate) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Garantía</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {service.warrantyUntil ? (
                  <p className={`flex items-center gap-1.5 text-sm ${warrantyActive(service.warrantyUntil) ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                    <ShieldCheck className="h-4 w-4" />
                    {warrantyActive(service.warrantyUntil) ? 'Vigente' : 'Vencida'} · hasta el {fmtDate(service.warrantyUntil)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Este caso no quedó con garantía.</p>
                )}
                {canCreate && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/services/nuevo?garantia_caso=${service.id}`}><RotateCcw className="mr-1 h-4 w-4" />Reingreso por garantía</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Fotos</CardTitle></CardHeader>
            <CardContent>
              <FotosDelCaso
                serviceId={service.id}
                companyId={appUser?.impersonatedCompanyId ?? appUser?.companyId}
                canEdit={canEdit && open}
              />
            </CardContent>
          </Card>

          {/* Chequeos */}
          {service.intakeChecklist.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Cómo llegó</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {service.intakeChecklist.map((c) => (
                  <div key={c.itemId} className="text-sm">
                    <span>{c.label}: </span>
                    <span className={c.answer === 'no' ? 'font-semibold text-destructive' : 'font-semibold'}>{ANSWER_LABEL[c.answer]}</span>
                    {c.note && <span className="text-muted-foreground"> — {c.note}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ---- diálogos ---- */}
      <ReciboRecepcionDialog
        open={reciboOpen}
        onOpenChange={(o) => { setReciboOpen(o); if (!o && params.get('recibo')) router.replace(`/services/caso?id=${service.id}`); }}
        service={service}
        equipmentType={equipmentType}
        settings={config.settings}
      />

      <Dialog open={!!statusDialog} onOpenChange={(o) => !o && setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pasar a «{statusDialog ? SERVICE_STATUS[statusDialog].label : ''}»</DialogTitle>
            <DialogDescription>Queda en el historial con tu nombre y la hora.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea aria-label="Nota del cambio" rows={3} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Nota (opcional): «la pieza llega el jueves»" />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={statusVisible} onCheckedChange={(v) => setStatusVisible(v === true)} />
              Que el cliente vea esta nota
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setStatusDialog(null)}>Cancelar</Button>
            <Button onClick={changeStatus} disabled={busy}>{busy ? 'Guardando…' : 'Cambiar estado'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{service.assignedTo ? 'Pasar a otro técnico' : 'Asignar el caso'}</DialogTitle>
            <DialogDescription>Queda anotado en el historial, con el motivo si lo escribes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {config.technicians.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay técnicos en esta sucursal. Márcalos en <Link className="underline" href="/service-types">Configuración del Taller → Técnicos</Link>.
              </p>
            ) : (
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger aria-label="Técnico"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNO}>Sin asignar</SelectItem>
                  {config.technicians.map((t) => <SelectItem key={t.profileId} value={t.profileId}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input aria-label="Motivo" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} placeholder="Motivo (opcional)" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => assign(assignTo === NINGUNO ? null : assignTo, assignNote)}
              disabled={busy || (assignTo === NINGUNO ? !service.assignedTo : assignTo === service.assignedTo)}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entregar el caso {caseNumber(service.number)}</DialogTitle>
            <DialogDescription>
              {service.status === 'not_repaired' ? 'Se entrega sin reparar.' : 'Se entrega reparado.'} Queda registrado quién lo entregó y quién lo retiró.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="picked">Quién lo retira</Label>
              <Input id="picked" value={pickedUpBy} onChange={(e) => setPickedUpBy(e.target.value)} />
            </div>
            <Input aria-label="Nota de la entrega" value={deliverNote} onChange={(e) => setDeliverNote(e.target.value)} placeholder="Nota (opcional)" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeliverOpen(false)}>Cancelar</Button>
            <Button onClick={deliver} disabled={busy}>{busy ? 'Guardando…' : 'Entregar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Cancelar el caso {caseNumber(service.number)}?</DialogTitle>
            <DialogDescription>
              {parts.length > 0
                ? `Las ${parts.length === 1 ? 'pieza vuelve' : `${parts.length} piezas vuelven`} al inventario. El caso queda en el historial como cancelado.`
                : 'El caso queda en el historial como cancelado.'}
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Motivo de la cancelación" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Motivo (opcional)" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Volver</Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>Cancelar caso</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editOpen && (
        <EditarFicha
          service={service}
          serialLabel={equipmentType?.serialLabel}
          asksPassword={!!equipmentType?.asksPassword}
          extraFields={equipmentType?.extraFields ?? []}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function EditarFicha({ service, serialLabel, asksPassword, extraFields, onClose, onSaved }: {
  service: Service;
  serialLabel?: string;
  asksPassword: boolean;
  extraFields: { key: string; label: string; type: 'text' | 'number' }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [brand, setBrand] = useState(service.equipmentBrand ?? '');
  const [model, setModel] = useState(service.equipmentModel ?? '');
  const [serial, setSerial] = useState(service.equipmentSerial ?? '');
  const [password, setPassword] = useState(service.equipmentPassword ?? '');
  const [details, setDetails] = useState<Record<string, string>>(service.equipmentDetails);
  const [description, setDescription] = useState(service.description);
  const [accessories, setAccessories] = useState(service.accessories ?? '');
  const [estimate, setEstimate] = useState(service.estimate?.toString() ?? '');
  const [promised, setPromised] = useState(service.promisedAt ? service.promisedAt.toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!description.trim()) { toast({ title: 'La falla reportada no puede quedar vacía', variant: 'destructive' }); return; }
    setSaving(true);
    const { error } = await supabase.from('services').update({
      equipment_brand: brand.trim() || null,
      equipment_model: model.trim() || null,
      equipment_serial: serial.trim() || null,
      equipment_password: asksPassword ? (password.trim() || null) : service.equipmentPassword ?? null,
      equipment_details: Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim() !== '')),
      description: description.trim(),
      accessories: accessories.trim() || null,
      estimate: estimate.trim() ? Math.round(Number(estimate) * 100) / 100 : null,
      promised_at: promised ? new Date(`${promised}T18:00:00`).toISOString() : null,
    }).eq('id', service.id);
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Ficha actualizada' });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar ficha</DialogTitle>
          <DialogDescription>Los chequeos de llegada no se cambian: son lo que se anotó al recibirlo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="ef-brand">Marca</Label><Input id="ef-brand" value={brand} onChange={(e) => setBrand(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ef-model">Modelo</Label><Input id="ef-model" value={model} onChange={(e) => setModel(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ef-serial">{serialLabel ?? 'Serie'}</Label><Input id="ef-serial" value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
            {asksPassword && (
              <div className="space-y-1.5"><Label htmlFor="ef-pass">Clave o patrón</Label><Input id="ef-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></div>
            )}
            {extraFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`ef-${f.key}`}>{f.label}</Label>
                <Input id={`ef-${f.key}`} value={details[f.key] ?? ''} onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5"><Label htmlFor="ef-desc">Falla reportada</Label><Textarea id="ef-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ef-acc">Dejó con el equipo</Label><Input id="ef-acc" value={accessories} onChange={(e) => setAccessories(e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="ef-est">Presupuesto aprox. (RD$)</Label><Input id="ef-est" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^\d.]/g, ''))} /></div>
            <div className="space-y-1.5"><Label htmlFor="ef-prom">Prometido para</Label><Input id="ef-prom" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
