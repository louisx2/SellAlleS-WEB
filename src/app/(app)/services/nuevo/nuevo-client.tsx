'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Camera, ShieldCheck, Trash, UserSearch, X, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/use-permission';
import { supabase } from '@/lib/supabase/client';
import { checklistToRow, rowToCustomer, rowToService, SERVICE_SELECT } from '@/lib/supabase/mappers';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity } from '@/lib/units';
import { caseNumber, checklistFor, fmtDate, missingRequired, warrantyActive } from '@/lib/taller';
import type { ChecklistAnswer, Customer, Product } from '@/lib/types';
import { CustomerSearchDialog } from '@/components/pos/customer-search-dialog';
import { useTallerConfig } from '@/components/taller/use-taller-config';
import { ChecklistForm } from '@/components/taller/checklist-form';
import { PartPicker } from '@/components/taller/part-picker';
import { abrirCobroDelCaso } from '@/components/taller/cobrar';
import { subirFotoDelCaso } from '@/components/taller/fotos';
import { useAuth } from '@/context/auth-provider';

const NINGUNO = 'none';
const ACCESORIOS = ['Cargador', 'Cable', 'Forro', 'Chip', 'Memoria', 'Caja'];

const isGeneric = (c?: Customer | null) =>
  !c || c.id === '0' || c.name.toLowerCase() === 'consumidor final';

export default function NuevoIngresoClient() {
  const router = useRouter();
  const params = useSearchParams();
  const quick = params.get('modo') === 'rapida';
  const garantiaCaso = params.get('garantia_caso');
  const garantiaVenta = params.get('garantia_venta');
  const { appUser } = useAuth();
  const { toast } = useToast();
  const canCreate = usePermission('services', 'create');
  const config = useTallerConfig();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [otherBringer, setOtherBringer] = useState(false);
  const [bringerName, setBringerName] = useState('');
  const [bringerPhone, setBringerPhone] = useState('');

  const [equipmentTypeId, setEquipmentTypeId] = useState<string>(NINGUNO);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [password, setPassword] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer | undefined>>({});
  const [accessories, setAccessories] = useState<string[]>([]);
  const [otherAccessories, setOtherAccessories] = useState('');
  const [estimate, setEstimate] = useState('');
  const [promised, setPromised] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>(NINGUNO);

  // Reparación rápida
  const [serviceTypeId, setServiceTypeId] = useState<string>('');
  const [part, setPart] = useState<Product | null>(null);
  const [partQty, setPartQty] = useState(1);
  const [showAllChecks, setShowAllChecks] = useState(false);

  const [saving, setSaving] = useState(false);
  const [fotos, setFotos] = useState<File[]>([]);
  // Reingreso por garantía: de qué viene, para mostrarlo y guardarlo.
  const [garantia, setGarantia] = useState<
    | { tipo: 'caso'; id: string; numero: number; hasta?: string }
    | { tipo: 'venta'; id: string; fecha: Date; ncf?: string }
    | null
  >(null);

  // Precarga desde el caso o la venta original.
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
        if (o.equipmentTypeId) setEquipmentTypeId(o.equipmentTypeId);
        setBrand(o.equipmentBrand ?? ''); setModel(o.equipmentModel ?? ''); setSerial(o.equipmentSerial ?? '');
        setPassword(o.equipmentPassword ?? ''); setDetails(o.equipmentDetails ?? {});
      } else if (garantiaVenta) {
        const { data } = await supabase
          .from('sales')
          .select('id, created_at, ncf, customers(id,name,phone,email,rnc,ncf_type,discount_percentage,credit_balance,loyalty_purchase_count), sale_items(product_name)')
          .eq('id', garantiaVenta).maybeSingle();
        if (!data) return;
        setGarantia({ tipo: 'venta', id: data.id, fecha: new Date(data.created_at), ncf: data.ncf ?? undefined });
        const c: any = Array.isArray(data.customers) ? data.customers[0] : data.customers;
        if (c && String(c.name ?? '').toLowerCase() !== 'consumidor final') setCustomer(rowToCustomer(c));
        const items = (data.sale_items ?? []) as { product_name: string }[];
        if (items.length === 1) setModel(items[0].product_name);
        else if (items.length > 1) setDescription(`Garantía de: ${items.map((i) => i.product_name).join(', ')}`);
      }
    })();
  }, [garantiaCaso, garantiaVenta]);

  const activeTypes = config.equipmentTypes.filter((t) => t.isActive);
  const equipmentType = activeTypes.find((t) => t.id === equipmentTypeId);

  // Con un solo tipo de equipo, ya viene elegido.
  useEffect(() => {
    if (equipmentTypeId === NINGUNO && activeTypes.length === 1) setEquipmentTypeId(activeTypes[0].id);
  }, [activeTypes, equipmentTypeId]);

  const checks = useMemo(
    () => checklistFor(config.checklist, equipmentType?.id),
    [config.checklist, equipmentType?.id],
  );
  // En rápida se muestran los obligatorios de rápida; el resto, a pedido.
  const shownChecks = quick && !showAllChecks ? checks.filter((c) => c.requiredQuick) : checks;

  const catalog = config.catalog.filter((s) => s.isActive && s.productId
    && (!s.equipmentTypeId || !equipmentType || s.equipmentTypeId === equipmentType.id));
  const service = catalog.find((s) => s.id === serviceTypeId);
  // En garantía, servicio y pieza entran en 0 (se puede cobrar algo después en el caso).
  const enGarantia = !!garantia;
  const quickTotal = enGarantia ? 0 : (service?.price ?? 0) + (part ? part.price * partQty : 0);

  const toggleAccessory = (a: string) =>
    setAccessories((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const validate = (): string | null => {
    if (!config.branchId) return 'No hay una sucursal activa.';
    if (quick && !service) return 'Elige el servicio que se va a hacer.';
    if (garantiaCaso && !garantia) return 'Todavía se está cargando el caso original.';
    if (!quick && !description.trim()) return 'Explica la falla que reporta el cliente.';
    if (estimate.trim() && !(Number(estimate) >= 0)) return 'El presupuesto no es un número válido.';
    if (part && part.tracksStock && partQty > part.stock) return `Solo quedan ${formatQuantity(part.stock, part.unit)} de ${part.name}.`;
    const missing = missingRequired(checks, answers, quick);
    if (missing) return `Falta el chequeo «${missing.label}».`;
    return null;
  };

  const save = async (cobrarAhora: boolean) => {
    const problem = validate();
    if (problem) { toast({ title: problem, variant: 'destructive' }); return; }
    setSaving(true);

    const answered = checks.map((c) => answers[c.id]).filter((a): a is ChecklistAnswer => !!a);
    const accesoriosTexto = [...accessories, otherAccessories.trim()].filter(Boolean).join(', ');
    const generic = isGeneric(customer);
    const withBringer = generic || otherBringer;

    const { data, error } = await supabase.from('services').insert({
      branch_id: config.branchId,
      customer_id: generic ? null : customer!.id,
      description: description.trim() || service?.name || 'Reparación',
      equipment_type_id: equipmentType?.id ?? null,
      equipment_brand: brand.trim() || null,
      equipment_model: model.trim() || null,
      equipment_serial: serial.trim() || null,
      equipment_password: equipmentType?.asksPassword ? (password.trim() || null) : null,
      equipment_details: Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim() !== '')),
      accessories: accesoriosTexto || null,
      intake_checklist: checklistToRow(answered),
      brought_by_name: withBringer ? (bringerName.trim() || null) : null,
      brought_by_phone: withBringer ? (bringerPhone.trim() || null) : null,
      estimate: estimate.trim() ? Math.round(Number(estimate) * 100) / 100 : null,
      promised_at: promised ? new Date(`${promised}T18:00:00`).toISOString() : null,
      assigned_to: assignedTo === NINGUNO ? null : assignedTo,
      is_quick: quick,
      status: quick ? 'in_repair' : 'received',
      warranty_of_service_id: garantia?.tipo === 'caso' ? garantia.id : null,
      warranty_sale_id: garantia?.tipo === 'venta' ? garantia.id : null,
    }).select('id').single();

    if (error || !data) {
      setSaving(false);
      toast({ title: 'No se pudo ingresar el caso', description: error?.message, variant: 'destructive' });
      return;
    }

    // Reparación rápida: la mano de obra del catálogo y la pieza, de una vez.
    if (quick && service) {
      const lines: Record<string, unknown>[] = [{
        service_id: data.id, product_id: service.productId, quantity: 1, price: enGarantia ? 0 : service.price,
        kind: 'labor', service_type_id: service.id,
      }];
      if (part) lines.push({ service_id: data.id, product_id: part.id, quantity: partQty, price: enGarantia ? 0 : part.price, kind: 'part' });
      const { error: itemsError } = await supabase.from('service_items').insert(lines);
      if (itemsError) {
        setSaving(false);
        toast({ title: 'El caso se creó, pero no sus líneas', description: itemsError.message, variant: 'destructive' });
        router.push(`/services/caso?id=${data.id}`);
        return;
      }
    }

    // Fotos elegidas al ingresar: se suben ya con el caso creado.
    const companyId = appUser?.impersonatedCompanyId ?? appUser?.companyId;
    if (fotos.length && companyId) {
      for (const f of fotos) {
        try { await subirFotoDelCaso(companyId, data.id, f); }
        catch (e) { toast({ title: 'Una foto no se subió', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
      }
    }

    if (cobrarAhora && quickTotal > 0) {
      const { data: row } = await supabase.from('services').select(SERVICE_SELECT).eq('id', data.id).single();
      const r = row ? await abrirCobroDelCaso(rowToService(row)) : { ok: false as const, error: 'No se pudo leer el caso.' };
      setSaving(false);
      if (r.ok) { router.push('/pos'); return; }
      toast({ title: 'El caso quedó creado, pero no se pudo abrir el cobro', description: r.error, variant: 'destructive' });
      router.push(`/services/caso?id=${data.id}`);
      return;
    }

    setSaving(false);
    toast({ title: 'Caso ingresado' });
    router.push(`/services/caso?id=${data.id}&recibo=1`);
  };

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="Nuevo ingreso" />
        <p className="text-sm text-muted-foreground">Tu rol no permite ingresar casos al taller.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/services"><ArrowLeft className="mr-1 h-4 w-4" />Taller</Link>
        </Button>
      </div>
      <PageHeader title={quick ? 'Reparación rápida' : 'Nuevo ingreso'}>
        <Button variant="outline" size="sm" asChild>
          <Link href={quick ? '/services/nuevo' : '/services/nuevo?modo=rapida'}>
            {quick ? 'Ingreso completo' : <><Zap className="mr-1 h-4 w-4" />Reparación rápida</>}
          </Link>
        </Button>
      </PageHeader>
      {quick && (
        <p className="mb-4 text-sm text-muted-foreground">
          Para el cliente que ya sabe lo que quiere: el caso entra directo en reparación, con el
          servicio y la pieza.
        </p>
      )}

      {garantia && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {garantia.tipo === 'caso' ? (
              <>
                Reingreso por garantía del caso{' '}
                <Link className="underline" href={`/services/caso?id=${garantia.id}`}>{caseNumber(garantia.numero)}</Link>.{' '}
                {garantia.hasta
                  ? (warrantyActive(garantia.hasta)
                    ? `Garantía vigente hasta el ${fmtDate(garantia.hasta)}.`
                    : `Ojo: la garantía venció el ${fmtDate(garantia.hasta)}.`)
                  : 'Ese caso no quedó con garantía.'}
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
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="font-medium">{isGeneric(customer) ? 'Consumidor final' : customer!.name}</p>
                  {!isGeneric(customer) && customer!.phone && <p className="text-sm text-muted-foreground">{customer!.phone}</p>}
                </div>
                <div className="flex gap-2">
                  {!isGeneric(customer) && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setCustomer(null)}>Quitar</Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                    <UserSearch className="mr-1 h-4 w-4" />{isGeneric(customer) ? 'Elegir cliente' : 'Cambiar'}
                  </Button>
                </div>
              </div>
              {!isGeneric(customer) && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={otherBringer} onCheckedChange={(v) => setOtherBringer(v === true)} />
                  Lo trae otra persona
                </label>
              )}
              {(isGeneric(customer) || otherBringer) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bringer-name">{isGeneric(customer) ? 'Nombre de quien lo trae' : 'Quién lo trae'}</Label>
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

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Equipo</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {activeTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin tipos de equipo configurados.{' '}
                  <Link href="/service-types" className="underline">Configúralos</Link> para tener chequeos y datos propios.
                </p>
              ) : activeTypes.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="eq-type">Tipo de equipo</Label>
                  <Select value={equipmentTypeId} onValueChange={(v) => { setEquipmentTypeId(v); setAnswers({}); setDetails({}); setServiceTypeId(''); }}>
                    <SelectTrigger id="eq-type"><SelectValue placeholder="Elige el tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Otro / sin tipo</SelectItem>
                      {activeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="brand">Marca</Label>
                  <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Apple, Samsung…" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="model">Modelo</Label>
                  <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="iPhone 13 Pro Max" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="serial">{equipmentType?.serialLabel ?? 'Serie'}</Label>
                  <Input id="serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
                </div>
                {equipmentType?.asksPassword && (
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Clave o patrón</Label>
                    <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="Para probar el equipo" />
                  </div>
                )}
                {equipmentType?.extraFields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                    <Input
                      id={`f-${f.key}`}
                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                      value={details[f.key] ?? ''}
                      onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {quick && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Servicio</CardTitle>
                <CardDescription>
                  {catalog.length === 0
                    ? <>No hay servicios en el catálogo. <Link href="/service-types" className="underline">Agrégalos</Link>.</>
                    : 'Lo que se va a hacer y la pieza que lleva.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
                  <SelectTrigger aria-label="Servicio"><SelectValue placeholder="Elige el servicio" /></SelectTrigger>
                  <SelectContent>
                    {catalog.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} · {formatCurrency(s.price)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {part ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="font-medium">{part.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(part.price)}{part.tracksStock ? ` · quedan ${formatQuantity(part.stock, part.unit)}` : ''}
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
                    suggestedCategoryId={service?.partCategoryId}
                    onPick={(p) => { setPart(p); setPartQty(1); }}
                  />
                )}
                <div className="flex justify-between border-t pt-3 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(quickTotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground">El ITBIS, si aplica, se calcula al cobrar en el POS.</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{quick ? 'Detalle (opcional)' : 'Falla reportada'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                aria-label="Falla reportada"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={quick ? 'Algo que el técnico deba saber' : 'Lo que cuenta el cliente: «se cayó, no da imagen pero vibra»'}
              />
            </CardContent>
          </Card>

          {checks.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Cómo llega el equipo</CardTitle>
                <CardDescription>Se imprime en el recibo. Los marcados con * son obligatorios.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ChecklistForm
                  items={shownChecks}
                  answers={answers}
                  onChange={setAnswers}
                  requiredOf={(i) => (quick ? i.requiredQuick : i.required)}
                />
                {quick && shownChecks.length < checks.length && (
                  <Button type="button" variant="link" className="px-0" onClick={() => setShowAllChecks(true)}>
                    Ver los {checks.length - shownChecks.length} chequeos restantes
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recepción</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Deja con el equipo</Label>
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
                <Input aria-label="Otros accesorios" value={otherAccessories} onChange={(e) => setOtherAccessories(e.target.value)} placeholder="Otro (opcional)" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {!quick && (
                  <div className="space-y-1.5">
                    <Label htmlFor="estimate">Presupuesto aprox. (RD$)</Label>
                    <Input id="estimate" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^\d.]/g, ''))} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="promised">Prometido para</Label>
                  <Input id="promised" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tech">Técnico</Label>
                  <Select value={assignedTo} onValueChange={setAssignedTo}>
                    <SelectTrigger id="tech"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Sin asignar</SelectItem>
                      {config.technicians.map((t) => <SelectItem key={t.profileId} value={t.profileId}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fotos (opcional)</CardTitle>
              <CardDescription>Para dejar constancia de cómo llegó: golpes, rayones, pantalla.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
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
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                <Camera className="h-4 w-4" />Agregar fotos
                <input
                  type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={(e) => { setFotos([...fotos, ...Array.from(e.target.files ?? [])].slice(0, 12)); e.target.value = ''; }}
                />
              </label>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" asChild><Link href="/services">Cancelar</Link></Button>
            {quick && !enGarantia ? (
              <>
                <Button type="submit" variant="outline" disabled={saving}>Guardar y cobrar al entregar</Button>
                <Button type="button" disabled={saving} onClick={() => save(true)}>
                  {saving ? 'Guardando…' : `Cobrar ahora · ${formatCurrency(quickTotal)}`}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Ingresar e imprimir recibo'}</Button>
            )}
          </div>
        </form>
      )}

      <CustomerSearchDialog
        isOpen={searchOpen}
        onOpenChange={setSearchOpen}
        onCustomerSelected={(c) => { setCustomer(c); setSearchOpen(false); }}
      />
    </div>
  );
}
