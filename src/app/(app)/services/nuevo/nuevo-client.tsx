'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Camera, ShieldCheck, Trash, UserSearch, X, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { supabase } from '@/lib/supabase/client';
import { checklistToRow, rowToCustomer, rowToCustomerSubject, rowToService, SERVICE_SELECT } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity } from '@/lib/units';
import { caseNumber, checklistFor, fmtDate, missingRequired, ordenNueva, warrantyActive } from '@/lib/taller';
import type { ChecklistAnswer, Customer, CustomerSubject, Product, ServiceType } from '@/lib/types';
import { CustomerSearchDialog } from '@/components/pos/customer-search-dialog';
import { useTallerConfig } from '@/components/taller/use-taller-config';
import { ChecklistForm } from '@/components/taller/checklist-form';
import { PartPicker } from '@/components/taller/part-picker';
import {
  FichaPicker, SELECT_CLASS, copiaDeFicha, fichaNueva, fichaVacia, tipoIdDeFicha, type FichaValue,
} from '@/components/taller/ficha-picker';
import { LineasNuevas, type LineaNueva } from '@/components/taller/lineas-nuevas';
import { abrirCobroDelCaso } from '@/components/taller/cobrar';
import { subirFotoDelCaso } from '@/components/taller/fotos';
import { useAuth } from '@/context/auth-provider';

const ACCESORIOS = ['Cargador', 'Cable', 'Forro', 'Chip', 'Memoria', 'Caja'];

const isGeneric = (c?: Customer | null) =>
  !c || c.id === '0' || c.name.toLowerCase() === 'consumidor final';

/** ¿Sirve el servicio del catálogo para este tipo de ficha? Sin tipo de un lado, sí. */
const sirvePara = (s: ServiceType, tipoId?: string) => !s.equipmentTypeId || !tipoId || s.equipmentTypeId === tipoId;

export default function NuevoIngresoClient() {
  const router = useRouter();
  const params = useSearchParams();
  const modo = params.get('modo');
  // «Reparación rápida» (?modo=rapida) ahora es «Atender ahora».
  const ahora = modo === 'ahora' || modo === 'rapida';
  const garantiaCaso = params.get('garantia_caso');
  const garantiaVenta = params.get('garantia_venta');
  const { appUser } = useAuth();
  const { toast } = useToast();
  const canCreate = usePermission('services', 'create');
  const config = useTallerConfig();

  useEffect(() => {
    if (modo !== 'rapida') return;
    const q = new URLSearchParams(params.toString());
    q.set('modo', 'ahora');
    router.replace(`/services/nuevo?${q.toString()}`);
  }, [modo, params, router]);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [otherBringer, setOtherBringer] = useState(false);
  const [bringerName, setBringerName] = useState('');
  const [bringerPhone, setBringerPhone] = useState('');

  const [ficha, setFicha] = useState<FichaValue>({ mode: 'none' });
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer | undefined>>({});
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [accessories, setAccessories] = useState<string[]>([]);
  const [otherAccessories, setOtherAccessories] = useState('');
  const [estimate, setEstimate] = useState('');
  const [promised, setPromised] = useState('');

  const [lineas, setLineas] = useState<LineaNueva[]>([]);
  const [responsable, setResponsable] = useState('');
  const [part, setPart] = useState<Product | null>(null);
  const [partQty, setPartQty] = useState(1);

  // A domicilio: mientras nadie lo toque, sale del primer servicio o de la sucursal.
  const [atCustomerManual, setAtCustomerManual] = useState<boolean | null>(null);
  const [direccion, setDireccion] = useState('');
  const [clienteEspera, setClienteEspera] = useState(false);

  const [saving, setSaving] = useState(false);
  const [fotos, setFotos] = useState<File[]>([]);
  // Reingreso por garantía: de qué viene, para mostrarlo y guardarlo.
  const [garantia, setGarantia] = useState<
    | { tipo: 'caso'; id: string; numero: number; hasta?: string }
    | { tipo: 'venta'; id: string; fecha: Date; ncf?: string }
    | null
  >(null);
  const enGarantia = !!garantia;

  // Precarga desde la orden o la venta original.
  useEffect(() => {
    (async () => {
      if (garantiaCaso) {
        const { data } = await supabase.from('services').select(SERVICE_SELECT).eq('id', garantiaCaso).maybeSingle();
        if (!data) return;
        const o = rowToService(data);
        setGarantia({ tipo: 'caso', id: o.id, numero: o.number, hasta: o.warrantyUntil });
        if (o.customer) setCustomer(o.customer);
        if (o.broughtByName || o.broughtByPhone) {
          setOtherBringer(!!o.customer); setBringerName(o.broughtByName ?? ''); setBringerPhone(o.broughtByPhone ?? '');
        }
        setPassword(o.equipmentPassword ?? '');
        let subject: CustomerSubject | null = null;
        if (o.subjectId) {
          const { data: s } = await supabase.from('customer_subjects').select('*').eq('id', o.subjectId).maybeSingle();
          if (s) subject = rowToCustomerSubject(s);
        }
        setFicha(subject ? { mode: 'saved', subject } : {
          ...fichaNueva(o.equipmentTypeId ?? ''),
          brand: o.equipmentBrand ?? '', model: o.equipmentModel ?? '', serial: o.equipmentSerial ?? '',
          details: o.equipmentDetails ?? {},
        });
      } else if (garantiaVenta) {
        const { data } = await supabase
          .from('sales')
          .select('id, created_at, ncf, customers(id,name,phone,email,rnc,ncf_type,discount_percentage,credit_balance,loyalty_purchase_count,address,collection_address), sale_items(product_name)')
          .eq('id', garantiaVenta).maybeSingle();
        if (!data) return;
        setGarantia({ tipo: 'venta', id: data.id, fecha: new Date(data.created_at), ncf: data.ncf ?? undefined });
        const c: any = Array.isArray(data.customers) ? data.customers[0] : data.customers;
        if (c && String(c.name ?? '').toLowerCase() !== 'consumidor final') setCustomer(rowToCustomer(c));
        const items = (data.sale_items ?? []) as { product_name: string }[];
        setFicha({ ...fichaNueva(), model: items.length === 1 ? items[0].product_name : '' });
        if (items.length > 1) setDescription(`Garantía de: ${items.map((i) => i.product_name).join(', ')}`);
      }
    })();
  }, [garantiaCaso, garantiaVenta]);

  const activeTypes = useMemo(() => config.equipmentTypes.filter((t) => t.isActive), [config.equipmentTypes]);
  // La garantía es de reparación: solo se ofrecen esos tipos.
  const pickerTypes = useMemo(
    () => (enGarantia ? activeTypes.filter((t) => t.isRepair) : activeTypes),
    [activeTypes, enGarantia],
  );
  const tipo = pickerTypes.find((t) => t.id === tipoIdDeFicha(ficha));
  const conFicha = ficha.mode !== 'none';
  const esReparacion = !!tipo?.isRepair;
  // Un negocio sin tipos de ficha (un salón) no ve la tarjeta; una garantía sí, para pedirla.
  const muestraFicha = pickerTypes.length > 0 || enGarantia || conFicha;

  // Con un solo tipo de ficha, la ficha nueva ya viene con él (una vez, al cargar).
  const inicial = useRef(false);
  useEffect(() => {
    if (config.loading || inicial.current) return;
    inicial.current = true;
    if (!garantiaCaso && !garantiaVenta && activeTypes.length === 1) {
      setFicha((f) => (f.mode === 'none' ? fichaNueva(activeTypes[0].id) : f));
    }
  }, [config.loading, activeTypes, garantiaCaso, garantiaVenta]);

  // Una ficha nueva sin tipo, o con uno que no se ofrece, toma el único que hay.
  useEffect(() => {
    if (config.loading || ficha.mode !== 'new' || pickerTypes.some((t) => t.id === ficha.equipmentTypeId)) return;
    const unico = pickerTypes.length === 1 ? pickerTypes[0].id : '';
    if (ficha.equipmentTypeId !== unico) setFicha({ ...ficha, equipmentTypeId: unico });
  }, [config.loading, ficha, pickerTypes]);

  // Otro tipo de ficha: otros chequeos, y fuera los servicios de otro tipo.
  const tipoKey = tipo?.id ?? '';
  useEffect(() => { setAnswers({}); setShowAllChecks(false); }, [tipoKey]);
  useEffect(() => {
    setLineas((ls) => {
      const quedan = ls.filter((l) => {
        const s = config.catalog.find((x) => x.id === l.serviceTypeId);
        return !!s && sirvePara(s, tipoKey || undefined);
      });
      return quedan.length === ls.length ? ls : quedan;
    });
  }, [tipoKey, config.catalog]);

  const checks = useMemo(
    () => (conFicha && tipo ? checklistFor(config.checklist, tipo.id) : []),
    [conFicha, tipo, config.checklist],
  );
  // En «Atender ahora» se muestran los obligatorios de rápida; el resto, a pedido.
  const shownChecks = ahora && !showAllChecks ? checks.filter((c) => c.requiredQuick) : checks;

  // En garantía lo que se agrega entra en RD$0 (se puede cobrar algo después en la orden).
  const catalog = useMemo(
    () => config.catalog
      .filter((s) => s.isActive && s.productId && sirvePara(s, tipo?.id))
      .map((s) => (enGarantia ? { ...s, price: 0 } : s)),
    [config.catalog, tipo?.id, enGarantia],
  );
  const catalogById = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);

  const activeStaff = useMemo(() => config.staff.filter((p) => p.isActive), [config.staff]);
  const staffName = (id?: string) => activeStaff.find((p) => p.id === id)?.name;
  const miPersona = config.myStaffIds.find((id) => activeStaff.some((p) => p.id === id));
  const ultima = lineas[lineas.length - 1];
  // Quién hace una línea nueva: el responsable, o quien hizo la anterior, o yo.
  const defaultStaffIds = responsable ? [responsable]
    : ultima?.staffIds.length ? ultima.staffIds
    : miPersona ? [miPersona]
    : activeStaff.length === 1 ? [activeStaff[0].id] : [];

  const generic = isGeneric(customer);
  const dirCliente = generic ? undefined : (customer!.collectionAddress?.trim() || customer!.address?.trim() || undefined);
  const primerServicio = config.catalog.find((s) => s.id === lineas[0]?.serviceTypeId);
  const atCustomer = atCustomerManual ?? (!!config.settings?.defaultAtCustomer || !!primerServicio?.atCustomerDefault);

  const orden = ordenNueva({
    ahora, tipo, clienteEspera, atCustomer, direccion,
    cliente: generic ? undefined : customer!,
    lineas, responsable: responsable || undefined,
  });
  const imprimeRecibo = conFicha && orden.stays_in_shop;

  // La pieza, como en la reparación rápida: solo al atender ahora una ficha de reparación.
  const muestraPieza = ahora && esReparacion;
  const pieza = muestraPieza ? part : null;
  const total = lineas.reduce((a, l) => a + l.price, 0) + (pieza && !enGarantia ? pieza.price * partQty : 0);
  const ofreceCobro = ahora && !enGarantia && total > 0;

  const elegirCliente = (c: Customer | null) => {
    setCustomer(c);
    // Las fichas guardadas son de cada cliente.
    if (ficha.mode === 'saved') setFicha({ mode: 'none' });
  };

  // Quien hace cada línea es, por defecto, el responsable: las líneas sin nadie lo toman.
  const elegirResponsable = (id: string) => {
    setResponsable(id);
    if (id) setLineas((ls) => ls.map((l) => (l.staffIds.length ? l : { ...l, staffIds: [id] })));
  };

  const toggleAccessory = (a: string) =>
    setAccessories((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const validate = (): string | null => {
    if (!config.branchId) return 'No hay una sucursal activa.';
    if (garantiaCaso && !garantia) return 'Todavía se está cargando la orden original.';
    if (ficha.mode === 'new' && !tipo) return 'Elige el tipo de ficha.';
    if (ficha.mode === 'saved' && !tipo) return 'El tipo de esa ficha ya no está activo: elige otra o crea una nueva.';
    if (enGarantia && !esReparacion) return 'La garantía es de una ficha de reparación: elige una o crea una nueva.';
    if (lineas.some((l) => !catalogById.has(l.serviceTypeId))) return 'Un servicio ya no está en el catálogo: quítalo.';
    if (ahora && lineas.length === 0) return 'Elige el servicio que se va a hacer.';
    if (!ahora && esReparacion && !description.trim()) return 'Explica la falla que reporta el cliente.';
    if (!ahora && !esReparacion && lineas.length === 0 && !description.trim()) return 'Elige un servicio o escribe qué se va a hacer.';
    if (atCustomer && !orden.service_address) return 'Escribe la dirección del servicio.';
    if (esReparacion && !ahora && estimate.trim() && !(Number(estimate) >= 0)) return 'El presupuesto no es un número válido.';
    if (pieza && pieza.tracksStock && partQty > pieza.stock) return `Solo quedan ${formatQuantity(pieza.stock, pieza.unit)} de ${pieza.name}.`;
    const missing = missingRequired(checks, answers, ahora);
    if (missing) return `Falta el chequeo «${missing.label}».`;
    return null;
  };

  const irALaOrden = (id: string) => router.push(`/services/caso?id=${id}`);

  const save = async (cobrarAhora: boolean) => {
    const problem = validate();
    if (problem) { toast({ title: problem, variant: 'destructive' }); return; }
    setSaving(true);

    const copia = copiaDeFicha(ficha);
    let usada = ficha;

    // 1. La ficha nueva de un cliente queda guardada para la próxima vez.
    if (usada.mode === 'new' && !generic && !fichaVacia(usada)) {
      const { data, error } = await supabase.from('customer_subjects').insert({
        customer_id: customer!.id,
        equipment_type_id: copia.equipment_type_id,
        brand: copia.equipment_brand,
        model: copia.equipment_model,
        serial: copia.equipment_serial,
        details: copia.equipment_details,
        notes: usada.notes.trim() || null,
      }).select('*').single();
      if (error || !data) {
        setSaving(false);
        toast({ title: 'No se pudo guardar la ficha del cliente', description: error?.message, variant: 'destructive' });
        return;
      }
      // Si algo falla después, al reintentar se usa esta ficha y no se crea otra igual.
      usada = { mode: 'saved', subject: rowToCustomerSubject(data) };
      setFicha(usada);
    }

    // 2. La orden.
    const answered = checks.map((c) => answers[c.id]).filter((a): a is ChecklistAnswer => !!a);
    const accesoriosTexto = conFicha
      ? [...(esReparacion ? accessories : []), otherAccessories.trim()].filter(Boolean).join(', ')
      : '';
    const withBringer = conFicha && (generic || otherBringer);
    const descripcion = description.trim()
      || lineas.map((l) => catalogById.get(l.serviceTypeId)?.name).filter(Boolean).join(', ')
      || tipo?.name || 'Servicio';

    const { data, error } = await supabase.from('services').insert({
      branch_id: config.branchId,
      customer_id: generic ? null : customer!.id,
      description: descripcion,
      ...copia,
      equipment_password: tipo?.asksPassword ? (password.trim() || null) : null,
      accessories: accesoriosTexto || null,
      intake_checklist: checklistToRow(answered),
      brought_by_name: withBringer ? (bringerName.trim() || null) : null,
      brought_by_phone: withBringer ? (bringerPhone.trim() || null) : null,
      estimate: esReparacion && !ahora && estimate.trim() ? Math.round(Number(estimate) * 100) / 100 : null,
      promised_at: esReparacion && promised ? new Date(`${promised}T18:00:00`).toISOString() : null,
      is_quick: ahora,
      ...orden,
      subject_id: usada.mode === 'saved' ? usada.subject.id : null,
      warranty_of_service_id: garantia?.tipo === 'caso' ? garantia.id : null,
      warranty_sale_id: garantia?.tipo === 'venta' ? garantia.id : null,
    }).select('id').single();

    if (error || !data) {
      setSaving(false);
      toast({
        title: 'No se pudo crear la orden',
        description: [error?.message, usada !== ficha ? 'La ficha del cliente sí quedó guardada.' : ''].filter(Boolean).join(' '),
        variant: 'destructive',
      });
      return;
    }

    // 3. Los servicios (y la pieza) con quién hace cada uno. Los ids salen de aquí
    //    para saber a qué línea va cada persona.
    const labor = lineas.map((l) => ({
      id: crypto.randomUUID(), service_id: data.id, product_id: catalogById.get(l.serviceTypeId)!.productId,
      quantity: 1, price: Math.round(l.price * 100) / 100, kind: 'labor', service_type_id: l.serviceTypeId,
    }));
    const rows: Record<string, unknown>[] = [...labor];
    if (pieza) {
      rows.push({
        id: crypto.randomUUID(), service_id: data.id, product_id: pieza.id, quantity: partQty,
        price: enGarantia ? 0 : pieza.price, kind: 'part', service_type_id: null,
      });
    }
    if (rows.length) {
      const { error: itemsError } = await supabase.from('service_items').insert(rows);
      if (itemsError) {
        setSaving(false);
        toast({ title: 'La orden se creó, pero no sus servicios', description: `${itemsError.message} Agrégalos desde la orden.`, variant: 'destructive' });
        irALaOrden(data.id);
        return;
      }
    }
    const staffRows = labor.flatMap((row, i) => lineas[i].staffIds.map((staffId) => ({ service_item_id: row.id, staff_id: staffId })));
    if (staffRows.length) {
      const { error: staffError } = await supabase.from('service_item_staff').insert(staffRows);
      if (staffError) {
        // Sin cobrar: una orden cobrada ya no deja cambiar quién hizo cada servicio.
        setSaving(false);
        toast({ title: 'La orden se creó, pero no quién hace cada servicio', description: `${staffError.message} Ponlo desde la orden antes de cobrar.`, variant: 'destructive' });
        irALaOrden(data.id);
        return;
      }
    }

    // Fotos elegidas al crear: se suben ya con la orden creada.
    const companyId = appUser?.impersonatedCompanyId ?? appUser?.companyId;
    if (conFicha && fotos.length && companyId) {
      for (const f of fotos) {
        try { await subirFotoDelCaso(companyId, data.id, f); }
        catch (e) { toast({ title: 'Una foto no se subió', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
      }
    }

    if (cobrarAhora && ofreceCobro) {
      const { data: row } = await supabase.from('services').select(SERVICE_SELECT).eq('id', data.id).single();
      const r = row ? await abrirCobroDelCaso(rowToService(row)) : { ok: false as const, error: 'No se pudo leer la orden.' };
      setSaving(false);
      if (r.ok) { router.push('/pos'); return; }
      toast({ title: 'La orden quedó creada, pero no se pudo abrir el cobro', description: r.error, variant: 'destructive' });
      irALaOrden(data.id);
      return;
    }

    setSaving(false);
    toast({ title: 'Orden creada' });
    // 4. El recibo de recepción, solo si queda algo en el negocio.
    router.push(`/services/caso?id=${data.id}${imprimeRecibo ? '&recibo=1' : ''}`);
  };

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="Nueva orden" />
        <p className="text-sm text-muted-foreground">Tu rol no permite crear órdenes de servicio.</p>
      </div>
    );
  }

  // Relleno compacto de las tarjetas de esta pantalla.
  const CH = 'p-4 pb-2';
  const CC = 'p-4 pt-0';

  // Total y botones: en el pie del panel (pantalla ancha) y en la barra de abajo
  // (teléfono). Uno de los dos lugares está siempre oculto (display: none).
  const acciones = (
    <div className="space-y-2">
      {(lineas.length > 0 || pieza) && (
        <div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">El ITBIS, si aplica, se calcula al cobrar en el POS.</p>
        </div>
      )}
      {/* Lo principal a la izquierda; Cancelar en rojo a la derecha. */}
      <div className="flex gap-2">
        {ofreceCobro ? (
          <>
            <Button type="button" className="flex-1 px-3" disabled={saving} onClick={() => save(true)}>
              {saving ? 'Guardando…' : 'Cobrar ahora'}
            </Button>
            <Button type="submit" variant="outline" className="flex-1 px-3" disabled={saving}>Cobrar al final</Button>
          </>
        ) : (
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? 'Guardando…' : imprimeRecibo ? 'Crear orden e imprimir recibo' : 'Crear orden'}
          </Button>
        )}
        <Button
          type="button" variant="outline" asChild
          className="border-destructive px-3 text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          <Link href="/services">Cancelar</Link>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Servicios</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{ahora ? 'Atender ahora' : 'Nueva orden'}</h1>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <Link href={ahora ? '/services/nuevo' : '/services/nuevo?modo=ahora'}>
            {ahora ? 'Nueva orden' : <><Zap className="mr-1 h-4 w-4" />Atender ahora</>}
          </Link>
        </Button>
      </div>
      {ahora && (
        <p className="mb-4 text-sm text-muted-foreground">
          Para el cliente que ya sabe lo que quiere: la orden entra directo en proceso, con sus servicios.
        </p>
      )}

      {garantia && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {garantia.tipo === 'caso' ? (
              <>
                Reingreso por garantía de la orden{' '}
                <Link className="underline" href={`/services/caso?id=${garantia.id}`}>{caseNumber(garantia.numero)}</Link>.{' '}
                {garantia.hasta
                  ? (warrantyActive(garantia.hasta)
                    ? `Garantía vigente hasta el ${fmtDate(garantia.hasta)}.`
                    : `Ojo: la garantía venció el ${fmtDate(garantia.hasta)}.`)
                  : 'Esa orden no quedó con garantía.'}
              </>
            ) : (
              <>Garantía de la venta del {garantia.fecha.toLocaleDateString('es-DO')}{garantia.ncf ? ` (${garantia.ncf})` : ''}.</>
            )}
            {' '}Lo que se agregue entra en RD$0.
          </div>
        </div>
      )}

      {config.loading ? (
        <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : (
        // Pantalla ancha: a la izquierda lo que se recibe, a la derecha el panel
        // fijo. En el teléfono, una columna en el orden del DOM: cliente y ficha,
        // servicios, lo demás y la barra de acciones. Filas auto/1fr: si el panel
        // es más alto que la izquierda, lo que sobra va abajo y no entre tarjetas.
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr] lg:items-start"
          onSubmit={(e) => { e.preventDefault(); save(false); }}
        >
          <div className="space-y-4 lg:col-start-1 lg:row-start-1">
            <Card>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Cliente</p>
                    <p className="font-medium">
                      {generic ? 'Consumidor final' : customer!.name}
                      {!generic && customer!.phone && <span className="font-normal text-muted-foreground"> · {customer!.phone}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!generic && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => elegirCliente(null)}>Quitar</Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                      <UserSearch className="mr-1 h-4 w-4" />{generic ? 'Elegir cliente' : 'Cambiar'}
                    </Button>
                  </div>
                </div>
                {conFicha && !generic && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={otherBringer} onCheckedChange={(v) => setOtherBringer(v === true)} />
                    Lo trae otra persona
                  </label>
                )}
                {conFicha && (generic || otherBringer) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="bringer-name">{generic ? 'Nombre de quien lo trae' : 'Quién lo trae'}</Label>
                      <Input id="bringer-name" value={bringerName} onChange={(e) => setBringerName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bringer-phone">Teléfono (para avisarle)</Label>
                      <Input id="bringer-phone" inputMode="tel" value={bringerPhone} onChange={(e) => setBringerPhone(e.target.value)} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {muestraFicha && (
              <Card>
                <CardHeader className={CH}><CardTitle className="text-base">Qué se atiende</CardTitle></CardHeader>
                <CardContent className={`space-y-3 ${CC}`}>
                  <FichaPicker
                    customerId={generic ? undefined : customer!.id}
                    types={pickerTypes}
                    value={ficha}
                    onChange={setFicha}
                    allowNone={!enGarantia}
                  />
                  {tipo?.asksPassword && (
                    <div className="space-y-1.5 sm:max-w-xs">
                      <Label htmlFor="password">Clave o patrón</Label>
                      <Input
                        id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off"
                        placeholder={esReparacion ? 'Para probar el equipo' : undefined}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Panel: fijo bajo el encabezado de la app y nunca más alto que la
              pantalla. Si no cabe, lo de arriba se desplaza dentro del panel y el
              total con los botones quedan abajo, a la vista. */}
          <Card className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col">
            <div className="space-y-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Servicios</CardTitle>
                <CardDescription>
                  {muestraPieza ? 'Lo que se va a hacer, quién lo hace y la pieza que lleva.' : 'Lo que se va a hacer y quién lo hace.'}
                </CardDescription>
              </div>
              <LineasNuevas
                catalog={catalog}
                staff={activeStaff}
                value={lineas}
                onChange={setLineas}
                defaultStaffIds={defaultStaffIds}
              />
              {activeStaff.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin personal en esta sucursal.{' '}
                  <Link href="/service-types" className="underline">Agrégalo</Link> para saber quién atiende cada orden.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="responsable">Lo atiende</Label>
                  <select id="responsable" className={SELECT_CLASS} value={responsable} onChange={(e) => elegirResponsable(e.target.value)}>
                    <option value="">
                      {lineas[0]?.staffIds[0] ? `${staffName(lineas[0].staffIds[0]) ?? 'Otra persona'} (hace el primer servicio)` : 'Sin asignar'}
                    </option>
                    {activeStaff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {muestraPieza && (
                <div className="space-y-2">
                  <Label>Pieza (opcional)</Label>
                  {part ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="font-medium">{part.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(enGarantia ? 0 : part.price)}{part.tracksStock ? ` · quedan ${formatQuantity(part.stock, part.unit)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" min={1} step={1} value={partQty}
                          onChange={(e) => setPartQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                          className="w-20" aria-label="Cantidad de la pieza"
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label="Quitar pieza" onClick={() => setPart(null)}><Trash className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ) : (
                    <PartPicker
                      branchId={config.branchId}
                      locationId={config.settings?.partsLocationId}
                      suggestedCategoryId={catalogById.get(lineas[0]?.serviceTypeId ?? '')?.partCategoryId}
                      onPick={(p) => { setPart(p); setPartQty(1); }}
                      enLinea
                    />
                  )}
                </div>
              )}

              <div className="space-y-3 border-t pt-3">
                <p className="text-sm font-medium">Dónde se atiende</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={atCustomer} onCheckedChange={(v) => setAtCustomerManual(v === true)} />
                  A domicilio
                </label>
                {atCustomer && (
                  <div className="space-y-1.5">
                    <Label htmlFor="direccion">Dirección del servicio</Label>
                    <Input
                      id="direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)}
                      placeholder={dirCliente ?? 'Calle, número, sector'}
                    />
                    {dirCliente && !direccion.trim() && (
                      <p className="text-xs text-muted-foreground">Si la dejas vacía, se usa la del cliente.</p>
                    )}
                  </div>
                )}
                {tipo?.staysInShop && !atCustomer && (
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={clienteEspera} onCheckedChange={(v) => setClienteEspera(v === true)} />
                      El cliente espera
                    </label>
                    <p className="ml-6 text-xs text-muted-foreground">
                      {clienteEspera ? 'No se queda en el negocio: se atiende y se termina.' : 'Se queda en el negocio hasta que lo retiren.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
            {/* Pegado abajo también mientras el panel todavía no llegó arriba
                (al abrir la página puede empezar más abajo de la pantalla). */}
            <div className="hidden shrink-0 rounded-b-lg border-t bg-card p-4 lg:sticky lg:bottom-0 lg:block">{acciones}</div>
          </Card>

          <div className="space-y-4 lg:col-start-1 lg:row-start-2">
            <Card>
              <CardHeader className={CH}>
                <CardTitle className="text-base">
                  {esReparacion ? (ahora ? 'Detalle (opcional)' : 'Falla reportada') : 'Notas'}
                </CardTitle>
              </CardHeader>
              <CardContent className={CC}>
                <Textarea
                  aria-label={esReparacion ? (ahora ? 'Detalle' : 'Falla reportada') : 'Notas'}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={esReparacion
                    ? (ahora ? 'Algo que el técnico deba saber' : 'Lo que cuenta el cliente: «se cayó, no da imagen pero vibra»')
                    : 'Lo que haya que saber: «corte bajito», «tocar el timbre al llegar»'}
                />
              </CardContent>
            </Card>

            {checks.length > 0 && (
              <Card>
                <CardHeader className={CH}>
                  <CardTitle className="text-base">{esReparacion ? 'Cómo llega el equipo' : 'Cómo llega'}</CardTitle>
                  <CardDescription>Se imprime en el recibo. Los marcados con * son obligatorios.</CardDescription>
                </CardHeader>
                <CardContent className={`space-y-2 ${CC}`}>
                  <ChecklistForm
                    items={shownChecks}
                    answers={answers}
                    onChange={setAnswers}
                    requiredOf={(i) => (ahora ? i.requiredQuick : i.required)}
                  />
                  {ahora && shownChecks.length < checks.length && (
                    <Button type="button" variant="link" className="px-0" onClick={() => setShowAllChecks(true)}>
                      Ver los {checks.length - shownChecks.length} chequeos restantes
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {conFicha && (
              <Card>
                <CardHeader className={CH}><CardTitle className="text-base">Recepción</CardTitle></CardHeader>
                <CardContent className={`space-y-4 ${CC}`}>
                  <div className="space-y-2">
                    <Label htmlFor="otros-accesorios">{esReparacion ? 'Deja con el equipo' : 'Lo que deja (opcional)'}</Label>
                    {esReparacion && (
                      <div className="flex flex-wrap gap-2">
                        {ACCESORIOS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            aria-pressed={accessories.includes(a)}
                            onClick={() => toggleAccessory(a)}
                            className={`rounded-full border px-3 py-1 text-sm ${accessories.includes(a) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    )}
                    <Input
                      id="otros-accesorios" value={otherAccessories} onChange={(e) => setOtherAccessories(e.target.value)}
                      placeholder={esReparacion ? 'Otro (opcional)' : 'Correa, casco, llaves…'}
                    />
                  </div>
                  {esReparacion && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {!ahora && (
                        <div className="space-y-1.5">
                          <Label htmlFor="estimate">Presupuesto aprox. (RD$)</Label>
                          <Input id="estimate" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^\d.]/g, ''))} />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="promised">Prometido para</Label>
                        <Input id="promised" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                        <Camera className="h-4 w-4" />Agregar fotos
                        <input
                          type="file" accept="image/*" capture="environment" multiple className="hidden"
                          onChange={(e) => { setFotos([...fotos, ...Array.from(e.target.files ?? [])].slice(0, 12)); e.target.value = ''; }}
                        />
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {esReparacion ? 'Opcional. Para dejar constancia de cómo llegó: golpes, rayones, pantalla.' : 'Opcional. Para dejar constancia de cómo llegó.'}
                      </span>
                    </div>
                    {fotos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {fotos.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                            {f.name.length > 22 ? `${f.name.slice(0, 20)}…` : f.name}
                            <button type="button" aria-label="Quitar foto" onClick={() => setFotos(fotos.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Teléfono y tableta: total y botones pegados abajo de la pantalla. */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6 lg:hidden">
            {acciones}
          </div>
        </form>
      )}

      <CustomerSearchDialog
        isOpen={searchOpen}
        onOpenChange={setSearchOpen}
        onCustomerSelected={(c) => { elegirCliente(c); setSearchOpen(false); }}
      />
    </div>
  );
}
