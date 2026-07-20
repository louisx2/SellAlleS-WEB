'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import type { PaymentMethod } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { usePayables, type NewSupplierInvoiceItem } from '@/context/payables-provider';
import { useSuppliers } from '@/context/supplier-provider';
import { useProducts } from '@/context/product-provider';
import { useModules } from '@/context/modules-provider';
import { useCaja } from '@/context/caja-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency, ITBIS_RATE } from '@/lib/utils';
import { EXPENSE_TYPES_606, ISR_RETENTION_TYPES_606, PAYMENT_FORMS_606, suggestPaymentForm606 } from '@/lib/dgii-606';
import { ChevronsUpDown, Loader2, Plus, Trash2 } from 'lucide-react';

interface PayableInvoiceDialogProps {
  children: React.ReactNode;
}

type ItemRow = {
  productId?: string;
  description: string;
  quantity: number | '';
  unitCost: number | '';
  itbisAmount: number | '';
};

const today = () => new Date().toISOString().slice(0, 10);
const num = (v: number | '') => (v === '' ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function PayableInvoiceDialog({ children }: PayableInvoiceDialogProps) {
  const { toast } = useToast();
  const { addInvoice } = usePayables();
  const { suppliers } = useSuppliers();
  const { products, reload: reloadProducts } = useProducts();
  const { isModuleEnabled } = useModules();
  const { isOpen: isCajaOpen } = useCaja();
  const { profile } = useCompanyProfile();

  // Empresas informales no llevan datos fiscales; el módulo 'purchases'
  // habilita las líneas de productos que entran al inventario.
  const showFiscal = profile.isFormalized;
  const purchasesOn = isModuleEnabled('purchases');
  const cashBlocked = isModuleEnabled('caja') && !isCajaOpen;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [condition, setCondition] = useState<'credit' | 'cash'>('credit');
  const [dueDate, setDueDate] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [goods, setGoods] = useState<number | ''>('');
  const [services, setServices] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  // Fiscal (solo formalizadas)
  const [ncf, setNcf] = useState('');
  const [ncfModified, setNcfModified] = useState('');
  const [expenseType, setExpenseType] = useState('09');
  const [itbisFacturado, setItbisFacturado] = useState<number | ''>('');
  const [itbisRetenido, setItbisRetenido] = useState<number | ''>('');
  const [itbisProporcionalidad, setItbisProporcionalidad] = useState<number | ''>('');
  const [itbisLlevadoCosto, setItbisLlevadoCosto] = useState<number | ''>('');
  const [isrRetentionType, setIsrRetentionType] = useState('');
  const [isrRetentionAmount, setIsrRetentionAmount] = useState<number | ''>('');
  const [impuestoSelectivo, setImpuestoSelectivo] = useState<number | ''>('');
  const [otrosImpuestos, setOtrosImpuestos] = useState<number | ''>('');
  const [propinaLegal, setPropinaLegal] = useState<number | ''>('');
  const [paymentForm, setPaymentForm] = useState('04');

  // Líneas de productos (solo con el módulo 'purchases')
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setSupplierId('');
    setInvoiceNumber('');
    setIssueDate(today());
    setCondition('credit');
    setDueDate('');
    setMethod(cashBlocked ? 'transfer' : 'cash');
    setReference('');
    setGoods('');
    setServices('');
    setNotes('');
    setNcf('');
    setNcfModified('');
    setExpenseType('09');
    setItbisFacturado('');
    setItbisRetenido('');
    setItbisProporcionalidad('');
    setItbisLlevadoCosto('');
    setIsrRetentionType('');
    setIsrRetentionAmount('');
    setImpuestoSelectivo('');
    setOtrosImpuestos('');
    setPropinaLegal('');
    setItems([]);
  }, [open, cashBlocked]);

  // Forma de pago 606 sugerida según cómo se registra la operación.
  useEffect(() => {
    setPaymentForm(suggestPaymentForm606(condition === 'credit', method));
  }, [condition, method]);

  const hasItems = items.length > 0;
  const itemsGoods = useMemo(() => round2(items.reduce((s, it) => s + num(it.quantity) * num(it.unitCost), 0)), [items]);
  const itemsItbis = useMemo(() => round2(items.reduce((s, it) => s + num(it.itbisAmount), 0)), [items]);

  const effGoods = hasItems ? itemsGoods : num(goods);
  const effServices = num(services);
  const effItbis = showFiscal ? (hasItems ? itemsItbis : num(itbisFacturado)) : 0;
  const extras = showFiscal ? num(impuestoSelectivo) + num(otrosImpuestos) + num(propinaLegal) : 0;
  const retenciones = showFiscal ? num(itbisRetenido) + num(isrRetentionAmount) : 0;
  const total = round2(effGoods + effServices + effItbis + extras);
  const aPagar = round2(total - retenciones);

  const setItem = (index: number, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const handleProductPick = (index: number, productId: string) => {
    if (productId === 'libre') {
      setItem(index, { productId: undefined });
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const row = items[index];
    const qty = num(row.quantity) || 1;
    setItem(index, {
      productId,
      description: product.name,
      quantity: qty,
      unitCost: product.cost,
      itbisAmount: showFiscal && product.itbis ? round2(qty * product.cost * ITBIS_RATE) : 0,
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supplierId) {
      toast({ title: 'Falta el suplidor', description: 'Selecciona el suplidor de la factura.', variant: 'destructive' });
      return;
    }
    if (!issueDate) {
      toast({ title: 'Falta la fecha', description: 'Indica la fecha del comprobante.', variant: 'destructive' });
      return;
    }
    if (effGoods + effServices <= 0) {
      toast({ title: 'Monto inválido', description: 'El monto facturado debe ser mayor que cero.', variant: 'destructive' });
      return;
    }
    for (const it of items) {
      if (!it.description.trim() && !it.productId) {
        toast({ title: 'Línea incompleta', description: 'Cada línea debe tener un producto o una descripción.', variant: 'destructive' });
        return;
      }
      if (num(it.quantity) <= 0) {
        toast({ title: 'Cantidad inválida', description: 'La cantidad de cada línea debe ser mayor que cero.', variant: 'destructive' });
        return;
      }
    }
    const cleanNcf = ncf.trim().toUpperCase();
    if (showFiscal && cleanNcf && !/^[BE][0-9]{10,12}$/.test(cleanNcf)) {
      toast({ title: 'NCF inválido', description: 'El NCF debe tener el formato B0100000001 (o e-CF).', variant: 'destructive' });
      return;
    }
    if (condition === 'cash') {
      if (method === 'cash' && cashBlocked) {
        toast({ title: 'Caja cerrada', description: 'Abre la caja de esta sucursal para pagar en efectivo.', variant: 'destructive' });
        return;
      }
      if (method === 'transfer' && !reference.trim()) {
        toast({ title: 'Falta la referencia', description: 'Indica la referencia de la transferencia.', variant: 'destructive' });
        return;
      }
    }

    const payloadItems: NewSupplierInvoiceItem[] = items.map((it) => ({
      productId: it.productId,
      description: it.description.trim(),
      quantity: num(it.quantity),
      unitCost: num(it.unitCost),
      itbisAmount: showFiscal ? num(it.itbisAmount) : 0,
    }));

    setSaving(true);
    try {
      await addInvoice({
        supplierId,
        branchName: localStorage.getItem('userBranch') || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        issueDate,
        dueDate: condition === 'credit' ? (dueDate || undefined) : undefined,
        subtotalGoods: effGoods,
        subtotalServices: effServices,
        ncf: showFiscal ? (cleanNcf || undefined) : undefined,
        ncfModified: showFiscal ? (ncfModified.trim() || undefined) : undefined,
        expenseType: showFiscal && cleanNcf ? expenseType : undefined,
        itbisFacturado: effItbis,
        itbisRetenido: showFiscal ? num(itbisRetenido) : 0,
        itbisProporcionalidad: showFiscal ? num(itbisProporcionalidad) : 0,
        itbisLlevadoCosto: showFiscal ? num(itbisLlevadoCosto) : 0,
        isrRetentionType: showFiscal && num(isrRetentionAmount) > 0 ? (isrRetentionType || '02') : undefined,
        isrRetentionAmount: showFiscal ? num(isrRetentionAmount) : 0,
        impuestoSelectivo: showFiscal ? num(impuestoSelectivo) : 0,
        otrosImpuestos: showFiscal ? num(otrosImpuestos) : 0,
        propinaLegal: showFiscal ? num(propinaLegal) : 0,
        paymentForm: showFiscal ? paymentForm : undefined,
        notes: notes.trim() || undefined,
        initialPayment: condition === 'cash' ? aPagar : 0,
        initialMethod: method,
        initialReference: condition === 'cash' ? (reference.trim() || undefined) : undefined,
        items: payloadItems,
      });
      if (payloadItems.some((it) => it.productId)) {
        // El stock lo sumó la RPC en el servidor; se relee para reflejarlo.
        await reloadProducts();
      }
      toast({
        title: 'Factura registrada',
        description: condition === 'cash'
          ? `Factura de ${formatCurrency(total)} registrada y pagada.`
          : `Factura de ${formatCurrency(total)} registrada a crédito.`,
      });
      setOpen(false);
    } catch (error: any) {
      console.error(error);
      toast({
        title: 'No se pudo registrar la factura',
        description: error?.message || 'Error de conexión con el servidor.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar Factura de Suplidor</DialogTitle>
          <DialogDescription>
            {showFiscal
              ? 'Registra la factura con sus datos fiscales para el Formato 606 de DGII.'
              : 'Registra la factura del suplidor y su condición de pago.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pi-supplier">Suplidor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="pi-supplier"><SelectValue placeholder="Selecciona un suplidor" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.rnc ? ` (${s.rnc})` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pi-number">No. de factura (opcional)</Label>
              <Input id="pi-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Número interno del suplidor" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pi-date">Fecha del comprobante</Label>
              <Input id="pi-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pi-condition">Condición de pago</Label>
              <Select value={condition} onValueChange={(v: 'credit' | 'cash') => setCondition(v)}>
                <SelectTrigger id="pi-condition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">A crédito (queda pendiente)</SelectItem>
                  <SelectItem value="cash">Al contado (pagada al registrar)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {condition === 'credit' ? (
              <div className="space-y-2">
                <Label htmlFor="pi-due">Fecha de vencimiento</Label>
                <Input id="pi-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={issueDate} />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pi-method">Método de pago</Label>
                  <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
                    <SelectTrigger id="pi-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash" disabled={cashBlocked}>Efectivo</SelectItem>
                      <SelectItem value="card">Tarjeta</SelectItem>
                      <SelectItem value="transfer">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                  {cashBlocked && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Sin caja abierta no puedes pagar en efectivo.</p>
                  )}
                </div>
                {(method === 'transfer' || method === 'card') && (
                  <div className="space-y-2">
                    <Label htmlFor="pi-reference">{method === 'transfer' ? 'Referencia de transferencia' : 'Referencia / aprobación'}</Label>
                    <Input id="pi-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                )}
              </>
            )}
          </div>

          {purchasesOn && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Productos de la compra (entran al inventario)</Label>
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => setItems((prev) => [...prev, { description: '', quantity: 1, unitCost: '', itbisAmount: '' }])}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Agregar línea
                  </Button>
                </div>
                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 sm:col-span-4 space-y-1">
                      <Label className="text-xs text-muted-foreground">Producto</Label>
                      <Select value={item.productId ?? 'libre'} onValueChange={(v) => handleProductPick(index, v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="libre">Línea libre (sin inventario)</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-3 space-y-1">
                      <Label className="text-xs text-muted-foreground">Descripción</Label>
                      <Input value={item.description} onChange={(e) => setItem(index, { description: e.target.value })} />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">Cantidad</Label>
                      <Input
                        type="number" step="0.01" min="0" value={item.quantity}
                        onChange={(e) => setItem(index, { quantity: e.target.value === '' ? '' : Number(e.target.value) })}
                      />
                    </div>
                    <div className="col-span-5 sm:col-span-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">Costo unit.</Label>
                      <Input
                        type="number" step="0.01" min="0" value={item.unitCost}
                        onChange={(e) => setItem(index, { unitCost: e.target.value === '' ? '' : Number(e.target.value) })}
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {hasItems && (
                  <p className="text-xs text-muted-foreground">
                    Monto en bienes calculado de las líneas: <span className="font-medium">{formatCurrency(itemsGoods)}</span>
                    {showFiscal && <> · ITBIS de las líneas: <span className="font-medium">{formatCurrency(itemsItbis)}</span></>}
                  </p>
                )}
              </div>
            </>
          )}

          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pi-goods">Monto facturado en bienes</Label>
              <Input
                id="pi-goods" type="number" step="0.01" min="0"
                value={hasItems ? itemsGoods : goods}
                onChange={(e) => setGoods(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={hasItems}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pi-services">Monto facturado en servicios</Label>
              <Input
                id="pi-services" type="number" step="0.01" min="0" value={services}
                onChange={(e) => setServices(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
          </div>

          {showFiscal && (
            <>
              <Separator />
              <div className="space-y-4">
                <p className="text-sm font-semibold">Datos fiscales (DGII · Formato 606)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pi-ncf">NCF recibido</Label>
                    <Input id="pi-ncf" value={ncf} onChange={(e) => setNcf(e.target.value.toUpperCase())} placeholder="B0100000001" />
                    {!ncf.trim() && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">Sin NCF, la factura no entra al Formato 606.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pi-expense-type">Tipo de gasto (casilla 3)</Label>
                    <Select value={expenseType} onValueChange={setExpenseType}>
                      <SelectTrigger id="pi-expense-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_TYPES_606.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pi-itbis">ITBIS facturado</Label>
                    <div className="flex gap-2">
                      <Input
                        id="pi-itbis" type="number" step="0.01" min="0"
                        value={hasItems ? itemsItbis : itbisFacturado}
                        onChange={(e) => setItbisFacturado(e.target.value === '' ? '' : Number(e.target.value))}
                        disabled={hasItems}
                      />
                      {!hasItems && (
                        <Button
                          type="button" variant="outline" size="sm" className="shrink-0"
                          onClick={() => setItbisFacturado(round2((num(goods) + num(services)) * ITBIS_RATE))}
                        >
                          18%
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pi-payment-form">Forma de pago (casilla 23)</Label>
                    <Select value={paymentForm} onValueChange={setPaymentForm}>
                      <SelectTrigger id="pi-payment-form"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_FORMS_606.map((f) => (
                          <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground">
                      <ChevronsUpDown className="mr-1 h-4 w-4" />
                      Retenciones e impuestos adicionales
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="pi-itbis-ret">ITBIS retenido</Label>
                      <Input id="pi-itbis-ret" type="number" step="0.01" min="0" value={itbisRetenido} onChange={(e) => setItbisRetenido(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-ncf-mod">NCF modificado (casilla 5)</Label>
                      <Input id="pi-ncf-mod" value={ncfModified} onChange={(e) => setNcfModified(e.target.value.toUpperCase())} placeholder="Solo notas de crédito/débito" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-isr-type">Tipo retención ISR</Label>
                      <Select value={isrRetentionType || 'none'} onValueChange={(v) => setIsrRetentionType(v === 'none' ? '' : v)}>
                        <SelectTrigger id="pi-isr-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin retención ISR</SelectItem>
                          {ISR_RETENTION_TYPES_606.map((t) => (
                            <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-isr-amount">Monto retención renta</Label>
                      <Input id="pi-isr-amount" type="number" step="0.01" min="0" value={isrRetentionAmount} onChange={(e) => setIsrRetentionAmount(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-itbis-prop">ITBIS sujeto a proporcionalidad</Label>
                      <Input id="pi-itbis-prop" type="number" step="0.01" min="0" value={itbisProporcionalidad} onChange={(e) => setItbisProporcionalidad(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-itbis-costo">ITBIS llevado al costo</Label>
                      <Input id="pi-itbis-costo" type="number" step="0.01" min="0" value={itbisLlevadoCosto} onChange={(e) => setItbisLlevadoCosto(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-isc">Impuesto selectivo al consumo</Label>
                      <Input id="pi-isc" type="number" step="0.01" min="0" value={impuestoSelectivo} onChange={(e) => setImpuestoSelectivo(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-otros">Otros impuestos/tasas</Label>
                      <Input id="pi-otros" type="number" step="0.01" min="0" value={otrosImpuestos} onChange={(e) => setOtrosImpuestos(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-propina">Propina legal (10%)</Label>
                      <Input id="pi-propina" type="number" step="0.01" min="0" value={propinaLegal} onChange={(e) => setPropinaLegal(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="pi-notes">Notas (opcional)</Label>
            <Textarea id="pi-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Separator />
          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Total factura</span><span className="font-semibold">{formatCurrency(total)}</span></div>
            {retenciones > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Retenciones (se remiten a DGII)</span><span>- {formatCurrency(retenciones)}</span></div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{condition === 'cash' ? 'A pagar ahora' : 'Queda pendiente'}</span>
              <span className="font-semibold">{formatCurrency(aPagar)}</span>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Factura
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
