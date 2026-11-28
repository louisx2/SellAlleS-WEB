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
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Ban, CheckCircle2, Eye, EyeOff, HandCoins, Link2, MessageCircle, Pencil, Printer, RotateCcw, ShieldCheck,
  StickyNote, Trash, UserCheck, Users, Zap,
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
  ANSWER_LABEL, camposDeFicha, canClose, caseNumber, closeLabel, daysInShop, equipmentLabel, isLate, isOpen,
  isReadyToDeliver, fmtDate, manualStatuses, mensajeDeEstado, statusCtx, statusLabel, valorDeFicha, warrantyActive,
  whatsappPhone,
} from '@/lib/taller';
import type { EquipmentType, Product, Service, ServiceEvent, ServiceItem, ServiceStatus } from '@/lib/types';
import { StatusBadge } from '@/components/taller/status-badge';
import { useTallerConfig } from '@/components/taller/use-taller-config';
import { PartPicker } from '@/components/taller/part-picker';
import { Historial } from '@/components/taller/historial';
import { ReciboRecepcionDialog } from '@/components/taller/recibo-recepcion';
import { abrirCobroDelCaso } from '@/components/taller/cobrar';
import { FotosDelCaso } from '@/components/taller/fotos';
import { useEnlaceSeguimiento } from '@/components/taller/use-enlace-seguimiento';
import { AsignarDialog, asignarOrden } from '@/components/taller/asignar-dialog';
import { PersonasLineaDialog } from '@/components/taller/personas-linea-dialog';
import { AgregarServicioDialog } from '@/components/taller/agregar-servicio-dialog';

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
  const [fichaNotas, setFichaNotas] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const [reciboOpen, setReciboOpen] = useState(params.get('recibo') === '1');
  const [statusDialog, setStatusDialog] = useState<ServiceStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [statusVisible, setStatusVisible] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [personasDe, setPersonasDe] = useState<ServiceItem | null>(null);
  const [agregarOpen, setAgregarOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [pickedUpBy, setPickedUpBy] = useState('');
  const [closeNote, setCloseNote] = useState('');
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
      supabase.from('service_items').select('*, products(*), service_item_staff(staff_id)').eq('service_id', id).order('created_at'),
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
    // Las notas de la ficha guardada del cliente («muerde», «alérgico a…»).
    if (s.subjectId) {
      const { data: f } = await supabase.from('customer_subjects').select('notes').eq('id', s.subjectId).maybeSingle();
      setFichaNotas(f?.notes?.trim() || null);
    } else {
      setFichaNotas(null);
    }
    setDiagnosis(s.diagnosis ?? '');
    setItems((its.data ?? []).map(rowToServiceItem));
    const evList = (evs.data ?? []).map(rowToServiceEvent);
    setEvents(evList);
    // Nombres de los usuarios que aparecen en el historial viejo (de/para en asignaciones).
    const ids = Array.from(new Set(evList.flatMap((e) => [e.fromUser, e.toUser]).filter(Boolean))) as string[];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id, name').in('id', ids);
      setNames(Object.fromEntries((data ?? []).map((p: any) => [p.id, p.name ?? 'Sin nombre'])));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload('services', load);

  const profile = useTicketProfile(service?.branchName);
  const enlaceDe = useEnlaceSeguimiento();
  const equipmentType = config.equipmentTypes.find((t) => t.id === service?.equipmentTypeId);
  const labor = items.filter((i) => i.kind === 'labor');
  const parts = items.filter((i) => i.kind === 'part');
  // Reingreso por garantía: lo que se agrega entra en 0 (se puede cambiar).
  const esGarantia = !!service && !!(service.warrantyOfServiceId || service.warrantySaleId);

  // El personal cargado es el de la sucursal activa: sirve si la orden es de ella.
  const personal = useMemo(
    () => config.staff.filter((p) => p.branchId === service?.branchId),
    [config.staff, service?.branchId],
  );
  const personalActivo = useMemo(() => personal.filter((p) => p.isActive), [personal]);
  const otraSucursal = !!service && !!config.branchId && service.branchId !== config.branchId
    ? (service.branchName || 'de la orden') : undefined;
  const miPersona = personalActivo.find((p) => config.myStaffIds.includes(p.id));
  const staffNames = useMemo(() => {
    const m: Record<string, string> = Object.fromEntries(config.staff.map((p) => [p.id, p.name]));
    if (service?.staff) m[service.staff.id] = service.staff.name;
    return m;
  }, [config.staff, service?.staff]);
  const nombresDe = (ids: string[]) => ids.map((x) => staffNames[x] ?? 'otra persona').join(', ');

  const catalog = config.catalog.filter((s) => s.isActive && s.productId
    && (!s.branchId || s.branchId === service?.branchId)
    && (!s.equipmentTypeId || !service?.equipmentTypeId || s.equipmentTypeId === service.equipmentTypeId));
  const suggestedCategory = useMemo(() => {
    const ids = new Set(labor.map((l) => l.serviceTypeId));
    return config.catalog.find((s) => ids.has(s.id) && s.partCategoryId)?.partCategoryId;
  }, [labor, config.catalog]);

  const fail = (title: string, error?: { message: string } | null) => {
    toast({ title, description: error?.message, variant: 'destructive' });
  };

  /** Después de cambiar quién atiende: sin «ver todas», quien se la pasa a otro
   *  deja de verla. Entonces vuelve a la lista, sin error. Si la consulta falla
   *  (red, sesión) no se sabe si la ve: se avisa del error y se recarga.
   *  Sin `titulo` (algo salió a medias y ya se avisó) no se dice «Listo». */
  const recargarOSalir = async (titulo?: string) => {
    const { data, error } = await supabase.from('services').select('id').eq('id', id).maybeSingle();
    if (error) {
      fail('No se pudo volver a cargar la orden', error);
      load();
      return;
    }
    if (!data) {
      toast(titulo
        ? { title: titulo, description: 'Ya no ves esta orden: ahora la atiende otra persona.' }
        : { title: 'Ya no ves esta orden', description: 'Ahora la atiende otra persona.' });
      router.push('/services');
      return;
    }
    if (titulo) toast({ title: titulo });
    load();
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
    toast({ title: `Ahora: ${statusLabel(statusDialog, statusCtx(service))}` });
    setStatusDialog(null); setStatusNote(''); setStatusVisible(false);
    load();
  };

  const tomar = async () => {
    if (!service || !miPersona) return;
    setBusy(true);
    const { error } = await asignarOrden(service.id, miPersona.id, 'Tomó la orden');
    setBusy(false);
    if (error) return fail('No se pudo tomar la orden', error);
    toast({ title: 'La orden es tuya' });
    load();
  };

  const onAssigned = (staffId: string | null) => {
    setAssignOpen(false);
    const nombre = staffId ? personal.find((p) => p.id === staffId)?.name : undefined;
    recargarOSalir(staffId ? `Ahora la atiende ${nombre ?? 'otra persona'}` : 'La orden quedó sin asignar');
  };

  // «El cliente espera» = no se queda en el negocio: se atiende y se termina.
  const cambiarEspera = async (espera: boolean) => {
    if (!service) return;
    setBusy(true);
    const { error } = await supabase.from('services').update({ stays_in_shop: !espera }).eq('id', service.id);
    setBusy(false);
    if (error) return fail('No se pudo cambiar', error);
    toast({ title: espera ? 'El cliente espera: se atiende y se termina' : 'Se queda en el negocio hasta que lo retiren' });
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

  // Entregar (se queda: pide quién retira) o Terminar (no se queda: no lo pide).
  const close = async () => {
    if (!service) return;
    const seQueda = service.staysInShop;
    setBusy(true);
    const { error } = await supabase.rpc('taller_entregar', {
      p_service_id: service.id,
      p_picked_up_by: seQueda ? (pickedUpBy.trim() || null) : null,
      p_note: closeNote.trim() || null,
    });
    setBusy(false);
    if (error) return fail(seQueda ? 'No se pudo entregar' : 'No se pudo terminar', error);
    setCloseOpen(false);
    toast({ title: seQueda ? 'Orden entregada' : 'Orden terminada' });
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
    toast({
      title: 'Orden cancelada',
      description: parts.length ? `${service.isRepair ? 'Las piezas' : 'Los materiales'} volvieron al inventario.` : undefined,
    });
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

  const addPart = async (p: Product) => {
    if (!service) return;
    const { error } = await supabase.from('service_items').insert({
      service_id: service.id, product_id: p.id, quantity: 1, price: esGarantia ? 0 : p.price, kind: 'part',
    });
    if (error) return fail(service.isRepair ? 'No se pudo agregar la pieza' : 'No se pudo agregar el material', error);
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
        <Button variant="ghost" size="sm" asChild><Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Servicios</Link></Button>
        <p className="text-sm text-muted-foreground">No se encontró la orden, o no tienes acceso a ella.</p>
      </div>
    );
  }

  const ctx = statusCtx(service);
  const esReparacion = service.isRepair;
  const conFicha = !!service.equipmentTypeId || !!equipmentLabel(service) || !!service.equipmentSerial;
  const campos = camposDeFicha(equipmentType);
  const phone = service.customer?.phone || service.broughtByPhone;
  const contactName = service.customer?.name ?? service.broughtByName;
  const waPhone = whatsappPhone(phone);
  const enlace = enlaceDe(service.trackingCode);
  const copiarEnlace = async () => {
    if (!enlace) return;
    try { await navigator.clipboard.writeText(enlace); toast({ title: 'Enlace copiado', description: 'Pégalo en el chat del cliente.' }); }
    catch { toast({ title: 'No se pudo copiar', description: enlace }); }
  };
  const unpaid = service.total > 0 && service.paymentStatus !== 'paid';
  const open = isOpen(service.status);
  const cobrada = service.paymentStatus === 'paid' || !!service.saleId;
  // Líneas: como la base (crear o editar Servicios), con la orden abierta y sin cobrar.
  const lineasEditables = open && !cobrada && (canEdit || canCreate);

  // Encabezado: «Orden #0142 · {ficha o servicios} · {cliente}».
  const nombresServicios = labor.map((l) => l.product.name).join(', ');
  const queSeAtiende = equipmentLabel(service) || (conFicha ? equipmentType?.name : '') || nombresServicios || service.description;
  const dias = daysInShop(service);
  const descripcionPorDefecto = nombresServicios || equipmentType?.name || 'Servicio';
  // Sin reparación, la descripción son las notas; la que se puso sola (los servicios) no se repite.
  const notas = service.description.trim();
  const muestraNotas = !esReparacion && !!notas && ![nombresServicios, equipmentType?.name, 'Servicio'].includes(notas);

  const estados = manualStatuses(ctx);
  if (!estados.includes(service.status)) estados.unshift(service.status);
  const muestraEspera = open && canEdit && service.status !== 'ready' && !service.atCustomer
    && (service.staysInShop || !!equipmentType?.staysInShop);
  const defaultLinea = service.staffId && personalActivo.some((p) => p.id === service.staffId) ? [service.staffId]
    : labor[labor.length - 1]?.staffIds.length ? labor[labor.length - 1].staffIds
    : miPersona ? [miPersona.id]
    : personalActivo.length === 1 ? [personalActivo[0].id] : [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-2">
        <Button variant="ghost" size="sm" asChild><Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Servicios</Link></Button>
      </div>

      {/* Cabecera */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Orden {caseNumber(service.number)}</h1>
            <StatusBadge status={service.status} ctx={ctx} />
            {service.isQuick && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Zap className="h-3 w-3" />Atender ahora</span>}
            {isLate(service) && <span className="text-xs font-medium text-destructive">Atrasada</span>}
          </div>
          <p className="text-sm text-muted-foreground">
            {[queSeAtiende, contactName ?? 'Consumidor final', ctx.staysInShop ? `${dias} ${dias === 1 ? 'día' : 'días'} aquí` : '']
              .filter(Boolean).join(' · ')}
          </p>
          {esGarantia && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-900/60 dark:text-sky-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reingreso por garantía
              {origen && <> de la <Link className="underline" href={`/services/caso?id=${origen.id}`}>orden {caseNumber(origen.number)}</Link></>}
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
            <Button variant="outline" size="sm" onClick={copiarEnlace} title="Enlace para que el cliente vea cómo va su orden">
              <Link2 className="mr-1 h-4 w-4" />Enlace
            </Button>
          )}
          {/* El recibo de recepción es para lo que se queda en el negocio. */}
          {service.staysInShop && (
            <Button variant="outline" size="sm" onClick={() => setReciboOpen(true)}><Printer className="mr-1 h-4 w-4" />Recibo</Button>
          )}
          {open && canEdit && unpaid && items.length > 0 && (
            <Button size="sm" onClick={cobrar} disabled={busy}><HandCoins className="mr-1 h-4 w-4" />Cobrar {formatCurrency(service.total)}</Button>
          )}
          {canClose(service.status, ctx) && canEdit && !unpaid && (
            <Button size="sm" onClick={() => { setPickedUpBy(contactName ?? ''); setCloseNote(''); setCloseOpen(true); }} disabled={busy}>
              <CheckCircle2 className="mr-1 h-4 w-4" />{closeLabel(ctx)}
            </Button>
          )}
        </div>
      </div>

      {/* Estado, quién la atiende y si el cliente espera */}
      {open && canEdit && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="st">Estado</Label>
              <Select value={service.status} onValueChange={(v) => { if (v !== service.status) setStatusDialog(v as ServiceStatus); }}>
                <SelectTrigger id="st" className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {estados.map((s) => <SelectItem key={s} value={s}>{statusLabel(s, ctx)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Lo atiende</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{service.staff?.name ?? 'Sin asignar'}</span>
                {!service.staffId && miPersona && (
                  <Button variant="outline" size="sm" onClick={tomar} disabled={busy}>
                    <UserCheck className="mr-1 h-4 w-4" />Tomar la orden
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                  <Users className="mr-1 h-4 w-4" />{service.staffId ? 'Pasar a otra persona' : 'Asignar'}
                </Button>
              </div>
            </div>
            {muestraEspera && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Switch id="espera" checked={!service.staysInShop} onCheckedChange={cambiarEspera} disabled={busy} />
                  <Label htmlFor="espera">El cliente espera</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {service.staysInShop ? 'Se queda en el negocio hasta que lo retiren.' : 'No se queda: se atiende y se termina.'}
                </p>
              </div>
            )}
            {canCancel && !service.saleId && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="mr-1 h-4 w-4" />Cancelar orden
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {ctx.staysInShop && isReadyToDeliver(service.status) && unpaid && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Está listo, pero falta cobrarlo: {formatCurrency(service.total)}. Después de cobrar en el POS, vuelve aquí para entregarlo.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Líneas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{esReparacion ? 'Servicios y piezas' : 'Servicios y materiales'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay nada que cobrar.</p>}
              {[...labor, ...parts].map((line) => (
                <div key={line.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{line.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.kind === 'labor'
                        ? `${esReparacion ? 'Mano de obra' : 'Servicio'} · ${line.staffIds.length ? `Lo hace ${nombresDe(line.staffIds)}` : 'Sin persona'}`
                        : `${esReparacion ? 'Pieza' : 'Material'}${line.product.tracksStock ? ` · quedan ${formatQuantity(line.product.stock, line.product.unit)}` : ''}`}
                    </p>
                  </div>
                  {line.kind === 'labor' && lineasEditables && !otraSucursal && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8" title="Quién lo hace"
                      aria-label={`Quién hace ${line.product.name}`} onClick={() => setPersonasDe(line)}
                    >
                      <Users className="h-4 w-4" />
                    </Button>
                  )}
                  {lineasEditables ? (
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
                  {lineasEditables && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Quitar ${line.product.name}`} onClick={() => removeLine(line)}>
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              {lineasEditables && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {otraSucursal ? (
                    <p className="text-sm text-muted-foreground">
                      Para agregar servicios o cambiar quién los hace, cambia a la sucursal {otraSucursal}.
                    </p>
                  ) : (
                    <Button variant="outline" onClick={() => setAgregarOpen(true)}>+ Agregar servicio</Button>
                  )}
                  {addingPart ? (
                    <PartPicker
                      autoFocus
                      branchId={service.branchId}
                      locationId={config.settings?.partsLocationId}
                      suggestedCategoryId={suggestedCategory}
                      onPick={addPart}
                      material={!esReparacion}
                    />
                  ) : (
                    <Button variant="outline" onClick={() => setAddingPart(true)}>+ Agregar {esReparacion ? 'pieza' : 'material'}</Button>
                  )}
                </div>
              )}

              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{esReparacion ? 'Mano de obra' : 'Servicios'}</span><span className="tabular-nums">{formatCurrency(service.laborPrice)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{esReparacion ? 'Piezas' : 'Materiales'}</span><span className="tabular-nums">{formatCurrency(service.partsTotal)}</span></div>
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

          {/* Diagnóstico (reparación) o notas */}
          {esReparacion ? (
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
          ) : muestraNotas && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Notas</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-line">{notas}</p></CardContent>
            </Card>
          )}

          {/* Historial */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Historial</CardTitle></CardHeader>
            <CardContent>
              <Historial events={events} ctx={ctx} names={names} staffNames={staffNames} canNote={canEdit} onNote={addNote} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Ficha (o los datos de la orden, si no tiene) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">{conFicha ? 'Ficha' : 'Datos'}</CardTitle>
              {canEdit && open && (
                <Button
                  variant="ghost" size="icon" className="h-8 w-8" aria-label={conFicha ? 'Editar ficha' : 'Editar notas'}
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5">
              {fichaNotas && (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="whitespace-pre-line"><span className="font-medium">Notas de la ficha: </span>{fichaNotas}</p>
                </div>
              )}
              <Dato k="Cliente" v={service.customer?.name ?? 'Consumidor final'} />
              <Dato k="Teléfono" v={phone ?? undefined}>{phone ? <a className="underline" href={`tel:${phone}`}>{phone}</a> : undefined}</Dato>
              <Dato k="Lo trajo" v={service.broughtByName && service.customer ? [service.broughtByName, service.broughtByPhone].filter(Boolean).join(' · ') : undefined} />
              <Dato k="Lo atiende" v={service.staff?.name ?? 'Sin asignar'} />
              {service.atCustomer && <Dato k="A domicilio" v={service.serviceAddress || 'Sin dirección'} />}
              {conFicha && (
                <>
                  <div className="my-2 border-t" />
                  <Dato k={esReparacion ? 'Equipo' : 'Qué se atiende'} v={equipmentType?.name} />
                  {campos.map((f) => <Dato key={f.key} k={f.label} v={valorDeFicha(service, f.key)} />)}
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
                  <Dato k={esReparacion ? 'Dejó' : 'Lo que dejó'} v={service.accessories} />
                  <Dato k="Prometido para" v={service.promisedAt?.toLocaleDateString('es-DO')} />
                </>
              )}
              <div className="my-2 border-t" />
              <Dato k="Recibió" v={`${service.receivedByName ?? '—'} · ${fecha(service.createdAt)}`} />
              {service.readyAt && <Dato k="Listo" v={fecha(service.readyAt)} />}
              {service.deliveredAt && (
                <Dato k={ctx.staysInShop ? 'Entregó' : 'Terminó'} v={`${service.deliveredByName ?? '—'} · ${fecha(service.deliveredAt)}`} />
              )}
              <Dato k="Retiró" v={service.pickedUpByName} />
            </CardContent>
          </Card>

          {/* La garantía es de las órdenes de reparación. */}
          {esReparacion && service.status === 'delivered' && (service.warrantyUntil || canCreate) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Garantía</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {service.warrantyUntil ? (
                  <p className={`flex items-center gap-1.5 text-sm ${warrantyActive(service.warrantyUntil) ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                    <ShieldCheck className="h-4 w-4" />
                    {warrantyActive(service.warrantyUntil) ? 'Vigente' : 'Vencida'} · hasta el {fmtDate(service.warrantyUntil)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Esta orden no quedó con garantía.</p>
                )}
                {canCreate && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/services/nuevo?garantia_caso=${service.id}`}><RotateCcw className="mr-1 h-4 w-4" />Reingreso por garantía</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {conFicha && (
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
          )}

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
        open={reciboOpen && service.staysInShop}
        onOpenChange={(o) => { setReciboOpen(o); if (!o && params.get('recibo')) router.replace(`/services/caso?id=${service.id}`); }}
        service={service}
        equipmentType={equipmentType}
        settings={config.settings}
      />

      <Dialog open={!!statusDialog} onOpenChange={(o) => !o && setStatusDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pasar a «{statusDialog ? statusLabel(statusDialog, ctx) : ''}»</DialogTitle>
            <DialogDescription>Queda en el historial con tu nombre y la hora.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              aria-label="Nota del cambio" rows={3} value={statusNote} onChange={(e) => setStatusNote(e.target.value)}
              placeholder={esReparacion ? 'Nota (opcional): «la pieza llega el jueves»' : 'Nota (opcional)'}
            />
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

      {assignOpen && (
        <AsignarDialog
          service={service}
          staff={personalActivo}
          otraSucursal={otraSucursal}
          onClose={() => setAssignOpen(false)}
          onAssigned={onAssigned}
        />
      )}

      {personasDe && (
        <PersonasLineaDialog
          line={personasDe}
          staff={personal}
          onClose={() => setPersonasDe(null)}
          onSaved={(ok) => { setPersonasDe(null); recargarOSalir(ok ? 'Listo: quedó quién lo hace' : undefined); }}
        />
      )}

      {agregarOpen && (
        <AgregarServicioDialog
          serviceId={service.id}
          catalog={catalog}
          staff={personal}
          defaultStaffIds={defaultLinea}
          enGarantia={esGarantia}
          onClose={() => setAgregarOpen(false)}
          onSaved={() => { setAgregarOpen(false); load(); }}
        />
      )}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{closeLabel(ctx)} la orden {caseNumber(service.number)}</DialogTitle>
            <DialogDescription>
              {ctx.staysInShop
                ? `${service.status === 'not_repaired' ? 'Se entrega sin reparar. ' : esReparacion ? 'Se entrega reparado. ' : ''}Queda registrado quién lo entregó y quién lo retiró.`
                : 'La orden queda terminada. Queda registrado quién la terminó.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {ctx.staysInShop && (
              <div className="space-y-1.5">
                <Label htmlFor="picked">Quién lo retira</Label>
                <Input id="picked" value={pickedUpBy} onChange={(e) => setPickedUpBy(e.target.value)} />
              </div>
            )}
            <Input aria-label="Nota" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Nota (opcional)" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancelar</Button>
            <Button onClick={close} disabled={busy}>{busy ? 'Guardando…' : closeLabel(ctx)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Cancelar la orden {caseNumber(service.number)}?</DialogTitle>
            <DialogDescription>
              {parts.length > 0
                ? `${parts.length === 1
                  ? (esReparacion ? 'La pieza vuelve' : 'El material vuelve')
                  : `${esReparacion ? `Las ${parts.length} piezas vuelven` : `Los ${parts.length} materiales vuelven`}`} al inventario. La orden queda en el historial como cancelada.`
                : 'La orden queda en el historial como cancelada.'}
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Motivo de la cancelación" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Motivo (opcional)" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Volver</Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>Cancelar orden</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editOpen && (
        <EditarFicha
          service={service}
          equipmentType={equipmentType}
          conFicha={conFicha}
          descripcionPorDefecto={descripcionPorDefecto}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}
    </div>
  );
}

/** Corrige la copia de la ficha y las notas de esta orden (la ficha guardada del
 *  cliente no cambia). Los campos y sus nombres son los del tipo de ficha. */
function EditarFicha({ service, equipmentType, conFicha, descripcionPorDefecto, onClose, onSaved }: {
  service: Service;
  equipmentType?: EquipmentType;
  conFicha: boolean;
  /** Lo que queda como descripción si las notas se dejan vacías (sin reparación). */
  descripcionPorDefecto: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const esReparacion = service.isRepair;
  const campos = camposDeFicha(equipmentType);
  const asksPassword = !!equipmentType?.asksPassword;
  const [valores, setValores] = useState({
    brand: service.equipmentBrand ?? '', model: service.equipmentModel ?? '', serial: service.equipmentSerial ?? '',
  });
  const [password, setPassword] = useState(service.equipmentPassword ?? '');
  const [details, setDetails] = useState<Record<string, string>>(service.equipmentDetails);
  const [description, setDescription] = useState(service.description);
  const [accessories, setAccessories] = useState(service.accessories ?? '');
  const [estimate, setEstimate] = useState(service.estimate?.toString() ?? '');
  const [promised, setPromised] = useState(service.promisedAt ? service.promisedAt.toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (esReparacion && !description.trim()) {
      toast({ title: 'La falla reportada no puede quedar vacía', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('services').update({
      ...(conFicha ? {
        equipment_brand: valores.brand.trim() || null,
        equipment_model: valores.model.trim() || null,
        equipment_serial: valores.serial.trim() || null,
        equipment_password: asksPassword ? (password.trim() || null) : service.equipmentPassword ?? null,
        equipment_details: Object.fromEntries(Object.entries(details).filter(([, v]) => String(v ?? '').trim() !== '')),
        accessories: accessories.trim() || null,
      } : {}),
      description: description.trim() || descripcionPorDefecto,
      ...(esReparacion ? {
        estimate: estimate.trim() ? Math.round(Number(estimate) * 100) / 100 : null,
        promised_at: promised ? new Date(`${promised}T18:00:00`).toISOString() : null,
      } : {}),
    }).eq('id', service.id);
    setSaving(false);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: conFicha ? 'Ficha actualizada' : 'Notas guardadas' });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{conFicha ? 'Editar ficha' : 'Editar notas'}</DialogTitle>
          <DialogDescription>
            {conFicha
              ? 'Cambia solo esta orden, no la ficha guardada del cliente. Los chequeos de llegada no se cambian: son lo que se anotó al recibirlo.'
              : 'Lo que haya que saber de esta orden.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {conFicha && (
            <div className="grid gap-3 sm:grid-cols-2">
              {campos.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`ef-${f.key}`}>{f.label}</Label>
                  <Input id={`ef-${f.key}`} value={valores[f.key]} onChange={(e) => setValores({ ...valores, [f.key]: e.target.value })} />
                </div>
              ))}
              {asksPassword && (
                <div className="space-y-1.5"><Label htmlFor="ef-pass">Clave o patrón</Label><Input id="ef-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></div>
              )}
              {(equipmentType?.extraFields ?? []).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`ef-x-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`ef-x-${f.key}`} inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={details[f.key] ?? ''} onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ef-desc">{esReparacion ? 'Falla reportada' : 'Notas'}</Label>
            <Textarea id="ef-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {conFicha && (
            <div className="space-y-1.5">
              <Label htmlFor="ef-acc">{esReparacion ? 'Dejó con el equipo' : 'Lo que dejó'}</Label>
              <Input id="ef-acc" value={accessories} onChange={(e) => setAccessories(e.target.value)} />
            </div>
          )}
          {esReparacion && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="ef-est">Presupuesto aprox. (RD$)</Label><Input id="ef-est" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^\d.]/g, ''))} /></div>
              <div className="space-y-1.5"><Label htmlFor="ef-prom">Prometido para</Label><Input id="ef-prom" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
