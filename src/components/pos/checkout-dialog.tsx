'use client';

import { useEffect, useRef, useState } from 'react';
import { useCart, getEffectiveUnitPrice } from '@/context/cart-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { formatCurrency, ITBIS_RATE } from '@/lib/utils';
import { formatQtyCompact } from '@/lib/units';
import { useToast } from '@/hooks/use-toast';
import type { Sale, FinancingDetails, NcfType } from '@/lib/types';
import { useProducts } from '@/context/product-provider';
import { useSales } from '@/context/sales-provider';
import { useCustomers } from '@/context/customer-provider';
import { FinancingDialog } from './financing-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '../ui/separator';
import { Textarea } from '../ui/textarea';
import { useAuth } from '@/context/auth-provider';
import { useModules } from '@/context/modules-provider';
import { useCaja } from '@/context/caja-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useNcfAvailability } from '@/hooks/use-ncf-availability';
import { Loader2 } from 'lucide-react';

interface CheckoutDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSaleComplete: (sale: Sale) => void;
}

export function CheckoutDialog({ isOpen, onOpenChange, onSaleComplete }: CheckoutDialogProps) {
  const { activeCart, total, subtotal, itbisAmount, itbisIncluded, totalDiscount, createSale, completeSale } = useCart();
  const { reload: reloadProducts } = useProducts();
  const { addSale: addSaleToContext } = useSales();
  const { customers, reload: reloadCustomers } = useCustomers();
  const { appUser } = useAuth();
  const { isModuleEnabled } = useModules();
  const { cashBlocked } = useCaja();
  // Los métodos de venta a plazo solo se ofrecen si la empresa tiene el módulo
  // activo (se configura en Plataforma → Módulos). Mantiene el checkout
  // consistente con lo que aparece en el menú.
  const creditEnabled = isModuleEnabled('credit');
  const financingEnabled = isModuleEnabled('financing');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'credit' | 'financing'>('cash');
  const [amountPaid, setAmountPaid] = useState<number | string>('');
  const [paymentReference, setPaymentReference] = useState('');
  // Método y referencia del abono inicial en ventas a crédito.
  const [downPaymentMethod, setDownPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [downPaymentReference, setDownPaymentReference] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [change, setChange] = useState(0);
  // Guardar la venta tarda: inserta en la base, relee inventario y a veces
  // clientes. En ese hueco el cajero cree que no respondió y vuelve a tocar.
  // El ref frena el segundo toque en el acto —el estado de React no llega a
  // tiempo si los dos clics caen en el mismo tick, que es justo lo que hace un
  // doble toque en una tableta—, y `guardandoVenta` es solo para la pantalla.
  const ventaEnCurso = useRef(false);
  const [guardandoVenta, setGuardandoVenta] = useState(false);
  const { toast } = useToast();
  const [isFinancingOpen, setFinancingOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState('Banreservas');
  const [selectedDownPaymentBank, setSelectedDownPaymentBank] = useState('Banreservas');
  // Comprobante fiscal: se emite solo si el cliente lo pide, para no quemar un
  // número autorizado por DGII en cada venta de mostrador.
  const { profile: companyProfile } = useCompanyProfile();
  const [ncfRequested, setNcfRequested] = useState(false);
  const [ncfType, setNcfType] = useState<NcfType>('consumer');
  const NCF_TIPO_LABEL: Record<NcfType, string> = {
    consumer: 'Consumidor Final (B02)',
    fiscal: 'Crédito Fiscal (B01)',
    gubernamental: 'Gubernamental (B15)',
    regimen_especial: 'Régimen Especial (B14)',
  };
  // Sin formalización ni emisión activa la base devuelve NULL igual: no tiene
  // sentido ofrecer el comprobante en el cobro.
  const ncfEmitible = !!companyProfile?.ncfEnabled;
  // Solo se ofrecen los tipos que tienen secuencia utilizable: ofrecer uno sin
  // rango autorizado sería mandar al cajero a un error al confirmar.
  const { tiposDisponibles } = useNcfAvailability(ncfEmitible && isOpen);
  const hayComprobantes = (tiposDisponibles?.length ?? 0) > 0;
  // B01/B15/B14 identifican al comprador ante DGII: sin RNC o cédula válida la
  // venta queda fuera del 607 (misma regla que classify607 en dgii-607.ts).
  const ncfNeedsCustomerId = ncfType === 'fiscal' || ncfType === 'gubernamental' || ncfType === 'regimen_especial';
  const customerIdDigits = (activeCart?.selectedCustomer?.rnc ?? '').replace(/\D/g, '');
  const customerIdIsValid = customerIdDigits.length === 9 || customerIdDigits.length === 11;


  useEffect(() => {
    if (isOpen) {
      setPaymentMethod(cashBlocked ? 'card' : 'cash');
      setAmountPaid(total);
      setPaymentReference('');
      setDownPaymentMethod(cashBlocked ? 'card' : 'cash');
      setDownPaymentReference('');
      setSaleNotes('');
      // Cada venta arranca sin comprobante: se pide a propósito, no por inercia.
      setNcfRequested(false);
      setNcfType(activeCart?.selectedCustomer?.ncfType ?? 'consumer');
    }
  }, [isOpen, total, cashBlocked, activeCart?.selectedCustomer?.ncfType]);

  // El tipo por defecto es el del cliente, pero solo si hay secuencia para él;
  // si no, el primero que sí se pueda emitir.
  useEffect(() => {
    if (!tiposDisponibles || tiposDisponibles.length === 0) return;
    setNcfType((actual) => {
      if (tiposDisponibles.includes(actual)) return actual;
      const delCliente = activeCart?.selectedCustomer?.ncfType;
      if (delCliente && tiposDisponibles.includes(delCliente)) return delCliente;
      return tiposDisponibles[0];
    });
  }, [tiposDisponibles, activeCart?.selectedCustomer?.ncfType]);

  useEffect(() => {
    if (paymentMethod === 'cash') {
      const paid = Number(amountPaid);
      if (paid >= total) {
        setChange(paid - total);
      } else {
        setChange(0);
      }
      setPaymentReference('');
    } else if (paymentMethod === 'credit') {
        setAmountPaid(0); // Default advance is 0 for credit
        setChange(0);
    } else { // card or transfer
      setAmountPaid(total);
      setChange(0);
    }
  }, [total, paymentMethod]);
  
  useEffect(() => {
    if (paymentMethod === 'cash') {
       const paid = Number(amountPaid);
        if (paid >= total) {
            setChange(paid - total);
        } else {
            setChange(0);
        }
    }
  }, [amountPaid, total, paymentMethod])
  
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const decimalRegex = /^\d*(\.\d{0,2})?$/;
    
    if (decimalRegex.test(value) && value.length <= 9) {
      setAmountPaid(value);
    }
  };

  // downPaymentOverride: el inicial del financiamiento llega como parámetro y
  // no vía estado (setAmountPaid + llamada síncrona leería el valor anterior).
  const handleConfirmSale = async (
    financingDetails?: FinancingDetails,
    downPaymentOverride?: number,
    downPaymentMethodOverride?: 'cash' | 'card' | 'transfer',
    downPaymentReferenceOverride?: string,
  ) => {
    if (!activeCart || !appUser) return;
    // Sin esto, dos toques = dos ventas insertadas y el cliente facturado dos
    // veces. La venta ya salió de aquí; deshacerla es un trabajo manual.
    if (ventaEnCurso.current) return;
    ventaEnCurso.current = true;
    setGuardandoVenta(true);

    const finalPaymentMethod = financingDetails ? 'financing' : paymentMethod;
    const effectiveDownPaymentMethod = downPaymentMethodOverride ?? downPaymentMethod;
    
    // Construct final references with bank prefix if transfer method is selected
    const finalPaymentReference = paymentMethod === 'transfer' && paymentReference.trim()
      ? `${selectedBank} - Ref: ${paymentReference.trim()}`
      : paymentReference.trim();

    const rawDownPaymentRef = downPaymentReferenceOverride ?? downPaymentReference;
    const finalDownPaymentReference = effectiveDownPaymentMethod === 'transfer' && rawDownPaymentRef.trim()
      ? `${selectedDownPaymentBank} - Ref: ${rawDownPaymentRef.trim()}`
      : rawDownPaymentRef.trim();

    const sale = createSale({
      paymentMethod: finalPaymentMethod,
      branchId: appUser.branch,
      amountPaid: downPaymentOverride !== undefined ? downPaymentOverride : Number(amountPaid),
      paymentReference: finalPaymentReference || undefined,
      downPaymentMethod: effectiveDownPaymentMethod,
      downPaymentReference: finalDownPaymentReference || undefined,
      financingDetails,
      notes: saleNotes,
      userName: appUser.name,
      userEmail: appUser.email,
      ncfRequested: ncfEmitible && hayComprobantes && ncfRequested,
      ncfType: ncfEmitible && hayComprobantes && ncfRequested ? ncfType : undefined,
    });

    try {
      // Guardar primero en la base; si falla, el carrito queda intacto.
      // Los triggers de la base validan el límite de crédito, generan las
      // cuotas y actualizan el balance del cliente en la misma transacción.
      const savedSale = await addSaleToContext(sale);

      // La base descuenta y valida el stock en la misma inserción de cada
      // detalle de venta. Releemos para mostrar el inventario real, incluso
      // si otra caja vendió al mismo tiempo.
      await reloadProducts();

      if (savedSale.paymentStatus === 'credit' || savedSale.paymentStatus === 'in_financing') {
        await reloadCustomers(); // el balance lo escribió el trigger
      }

      onSaleComplete(savedSale);
      completeSale(); // Signal that a sale has been completed, this will clear the active cart
      onOpenChange(false);

      toast({
        title: '¡Venta completada!',
        description: `Venta registrada con éxito${savedSale.ncf ? ` — NCF ${savedSale.ncf}` : ''}.`,
      });
    } catch (e: any) {
      console.error('Error al registrar la venta:', e);
      toast({
        title: 'No se pudo registrar la venta',
        description: e?.message ?? 'Error de conexión con el servidor. El carrito no se perdió.',
        variant: 'destructive',
      });
    } finally {
      // También al salir bien: el diálogo se cierra pero el componente sigue
      // montado, así que sin soltar el candado la siguiente venta no entraría.
      ventaEnCurso.current = false;
      setGuardandoVenta(false);
    }
  };

  const handleOpenFinancing = () => {
    if (paymentMethod === 'financing') {
      setFinancingOpen(true);
    }
  };

  const handleFinancingComplete = (details: {
    downPayment: number;
    financingDetails: FinancingDetails;
    downPaymentMethod?: 'cash' | 'card' | 'transfer';
    downPaymentReference?: string;
  }) => {
    setFinancingOpen(false); // Close financing dialog first
    // El inicial va como parámetro: setAmountPaid + llamada síncrona guardaría
    // la venta con el amountPaid del render anterior (= total).
    handleConfirmSale(details.financingDetails, details.downPayment, details.downPaymentMethod, details.downPaymentReference);
  };

  // Cliente FRESCO desde el provider: el snapshot del carrito persiste en
  // localStorage y su creditBalance/creditLimit pueden estar desactualizados.
  const freshCustomer = customers.find(c => c.id === activeCart?.selectedCustomer?.id);
  const availableCredit = freshCustomer?.creditLimit != null
    ? Math.max(freshCustomer.creditLimit - freshCustomer.creditBalance, 0)
    : null;

  const isCashPaymentInvalid = paymentMethod === 'cash' && (Number(amountPaid) < total || amountPaid === '');
  const isCashBlocked = paymentMethod === 'cash' && cashBlocked;
  const isRefPaymentInvalid = (paymentMethod === 'card' || paymentMethod === 'transfer') && !paymentReference.trim();
  const isCreditPaymentInvalid = (paymentMethod === 'credit' || paymentMethod === 'financing') && (!activeCart?.selectedCustomer || activeCart?.selectedCustomer.id === '0');
  const isCreditAmountInvalid = paymentMethod === 'credit' && (Number(amountPaid) > total || Number(amountPaid) < 0);
  // Abono inicial de una venta a crédito: si es en efectivo requiere caja abierta,
  // y si es transferencia requiere identificar la transferencia.
  const hasDownPayment = paymentMethod === 'credit' && Number(amountPaid) > 0;
  const isDownPaymentCashBlocked = hasDownPayment && downPaymentMethod === 'cash' && cashBlocked;
  const isDownPaymentRefInvalid = hasDownPayment && downPaymentMethod === 'transfer' && !downPaymentReference.trim();
  // Aviso temprano de límite (el rechazo definitivo lo hace el trigger en la base).
  const isOverCreditLimit = paymentMethod === 'credit' && availableCredit !== null
    && (total - Number(amountPaid || 0)) > availableCredit;

  const confirmButtonAction = () => {
    if (paymentMethod === 'financing') {
      handleOpenFinancing();
    } else {
      handleConfirmSale();
    }
  }


  if (!isOpen || !activeCart) return null;

  return (
    <>
    {/* Mientras se guarda no se cierra ni con Escape ni tocando fuera: la venta
        ya va camino de la base y cerrar aquí deja al cajero sin la factura. */}
    <Dialog open={isOpen && !isFinancingOpen} onOpenChange={(abierto) => { if (!guardandoVenta) onOpenChange(abierto); }}>
      <DialogContent className="sm:max-w-4xl grid grid-rows-[auto_1fr_auto] h-full max-h-[95vh]">
        <DialogHeader>
          <DialogTitle>Confirmar Venta</DialogTitle>
          <DialogDescription>
            Total a Pagar: <span className="font-bold text-lg">{formatCurrency(total)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-8 md:overflow-hidden overflow-y-auto py-4">
            <ScrollArea className='pr-4 -mr-4'>
            <div className="flex flex-col gap-6">
                <div>
                  <h3 className="mb-4 text-lg font-semibold">Método de Pago</h3>
                  <RadioGroup
                  value={paymentMethod}
                  onValueChange={(value: any) => setPaymentMethod(value)}
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                  >
                  <div>
                      <RadioGroupItem value="cash" id="cash" className="peer sr-only" disabled={cashBlocked} />
                      <Label
                          htmlFor="cash"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-green-600 peer-data-[state=checked]:bg-green-100/30 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
                      >
                      Efectivo
                      </Label>
                  </div>
                  <div>
                      <RadioGroupItem value="card" id="card" className="peer sr-only" />
                      <Label 
                          htmlFor="card" 
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-blue-600 peer-data-[state=checked]:bg-blue-100/30"
                      >
                      Tarjeta
                      </Label>
                  </div>
                  <div>
                      <RadioGroupItem value="transfer" id="transfer" className="peer sr-only" />
                      <Label 
                          htmlFor="transfer" 
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-orange-500 peer-data-[state=checked]:bg-orange-100/30"
                      >
                      Transf.
                      </Label>
                  </div>
                  {creditEnabled && (
                  <div>
                      <RadioGroupItem value="credit" id="credit" className="peer sr-only" disabled={!activeCart.selectedCustomer || activeCart.selectedCustomer.id === '0'} />
                      <Label
                          htmlFor="credit"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-destructive peer-data-[state=checked]:bg-red-100/30 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
                      >
                      Crédito
                      </Label>
                  </div>
                  )}
                  {financingEnabled && (
                  <div>
                      <RadioGroupItem value="financing" id="financing" className="peer sr-only" disabled={!activeCart.selectedCustomer || activeCart.selectedCustomer.id === '0'} />
                      <Label
                          htmlFor="financing"
                          className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-purple-600 peer-data-[state=checked]:bg-purple-100/30 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"
                      >
                      Financiar
                      </Label>
                  </div>
                  )}
                  </RadioGroup>
                  {isCreditPaymentInvalid && (
                      <p className="text-xs text-destructive mt-2">Debe seleccionar un cliente para vender a crédito o financiar.</p>
                  )}
                  {cashBlocked && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">No hay una caja abierta en esta sucursal. Abre caja para poder cobrar en efectivo.</p>
                  )}
                </div>

                 {paymentMethod === 'cash' && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                        <Label htmlFor="amount-paid">Monto Pagado</Label>
                        <Input
                            id="amount-paid"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amountPaid}
                            onChange={handleAmountChange}
                            onFocus={(e) => e.target.select()}
                        />
                        </div>
                        {Number(amountPaid) > 0 && change >= 0 && (
                        <div className="text-lg font-bold flex justify-between items-center text-primary bg-primary/10 p-3 rounded-md">
                            <span>Devolución:</span>
                            <span>{formatCurrency(change)}</span>
                        </div>
                        )}
                    </div>
                    )}

                {paymentMethod === 'card' && (
                    <div className="space-y-2">
                    <Label htmlFor="payment-reference">Referencia de Tarjeta</Label>
                    <Input
                        id="payment-reference"
                        type="text"
                        placeholder="Introducir número de referencia"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                    />
                    </div>
                )}

                {paymentMethod === 'transfer' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="bank">Banco</Label>
                      <Select value={selectedBank} onValueChange={setSelectedBank}>
                        <SelectTrigger id="bank"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Banreservas">Banreservas</SelectItem>
                          <SelectItem value="Banco Popular">Banco Popular</SelectItem>
                          <SelectItem value="BHD">BHD</SelectItem>
                          <SelectItem value="Scotiabank">Scotiabank</SelectItem>
                          <SelectItem value="APAP">Asociación Popular (APAP)</SelectItem>
                          <SelectItem value="Banco Santa Cruz">Banco Santa Cruz</SelectItem>
                          <SelectItem value="Banco Promerica">Banco Promerica</SelectItem>
                          <SelectItem value="Otro">Otro / Internacional</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="payment-reference">Referencia de Transferencia</Label>
                      <Input
                          id="payment-reference"
                          type="text"
                          placeholder="Introducir número de referencia"
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {paymentMethod === 'credit' && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                        <Label htmlFor="amount-paid-credit">Abono Inicial (Opcional)</Label>
                        <Input
                            id="amount-paid-credit"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amountPaid}
                            onChange={handleAmountChange}
                            onFocus={(e) => e.target.select()}
                        />
                        </div>
                        <div className="text-lg font-bold flex justify-between items-center text-destructive bg-destructive/10 p-3 rounded-md">
                            <span>Balance Pendiente:</span>
                            <span>{formatCurrency(total - Number(amountPaid))}</span>
                        </div>
                        {isCreditAmountInvalid && (
                            <p className="text-xs text-destructive">El abono no puede ser mayor que el total o negativo.</p>
                        )}
                        {Number(amountPaid) > 0 && (
                            <div className="space-y-2 border-t pt-3">
                                <Label htmlFor="down-payment-method">¿Cómo entró el abono inicial?</Label>
                                <Select value={downPaymentMethod} onValueChange={(v: 'cash' | 'card' | 'transfer') => setDownPaymentMethod(v)}>
                                    <SelectTrigger id="down-payment-method"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="cash" disabled={cashBlocked}>Efectivo</SelectItem>
                                        <SelectItem value="card">Tarjeta</SelectItem>
                                        <SelectItem value="transfer">Transferencia</SelectItem>
                                    </SelectContent>
                                </Select>
                                {downPaymentMethod === 'transfer' && (
                                    <div className="space-y-2">
                                      <Label htmlFor="down-payment-bank">Banco de Transferencia</Label>
                                      <Select value={selectedDownPaymentBank} onValueChange={setSelectedDownPaymentBank}>
                                        <SelectTrigger id="down-payment-bank"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="Banreservas">Banreservas</SelectItem>
                                          <SelectItem value="Banco Popular">Banco Popular</SelectItem>
                                          <SelectItem value="BHD">BHD</SelectItem>
                                          <SelectItem value="Scotiabank">Scotiabank</SelectItem>
                                          <SelectItem value="APAP">Asociación Popular (APAP)</SelectItem>
                                          <SelectItem value="Banco Santa Cruz">Banco Santa Cruz</SelectItem>
                                          <SelectItem value="Banco Promerica">Banco Promerica</SelectItem>
                                          <SelectItem value="Otro">Otro / Internacional</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                )}
                                {(downPaymentMethod === 'transfer' || downPaymentMethod === 'card') && (
                                    <div className="space-y-2">
                                      {downPaymentMethod === 'transfer' && <Label htmlFor="down-payment-reference">Referencia</Label>}
                                      <Input
                                          id="down-payment-reference"
                                          placeholder={downPaymentMethod === 'transfer' ? 'No. de transferencia / referencia' : 'No. de aprobación / referencia'}
                                          value={downPaymentReference}
                                          onChange={(e) => setDownPaymentReference(e.target.value)}
                                      />
                                    </div>
                                )}
                                {isDownPaymentCashBlocked && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">No hay caja abierta: no puedes recibir el abono inicial en efectivo.</p>
                                )}
                                {isDownPaymentRefInvalid && (
                                    <p className="text-xs text-destructive">Indica la referencia de la transferencia.</p>
                                )}
                            </div>
                        )}
                        {isOverCreditLimit && (
                            <p className="text-xs text-destructive">
                                La deuda nueva ({formatCurrency(total - Number(amountPaid || 0))}) excede el crédito
                                disponible del cliente ({formatCurrency(availableCredit ?? 0)}).
                            </p>
                        )}
                    </div>
                )}

                {ncfEmitible && (
                    <div className="rounded-lg border p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium">Comprobante fiscal (NCF)</p>
                                <p className="text-xs text-muted-foreground">
                                    Actívalo solo si el cliente pide comprobante: cada uno consume un
                                    número autorizado por DGII.
                                </p>
                            </div>
                            <Switch
                                checked={ncfRequested}
                                onCheckedChange={setNcfRequested}
                                disabled={!hayComprobantes}
                                aria-label="Emitir comprobante fiscal"
                            />
                        </div>

                        {tiposDisponibles !== null && !hayComprobantes && (
                            <p className="text-xs text-destructive">
                                No hay secuencias con números disponibles. Un administrador debe
                                registrar el rango autorizado por DGII en Perfil de Empresa →
                                Facturación Fiscal.
                            </p>
                        )}

                        {ncfRequested && hayComprobantes && (
                            <div className="space-y-2">
                                <Label htmlFor="ncf-type" className="text-xs">Tipo de comprobante</Label>
                                <Select value={ncfType} onValueChange={(v: NcfType) => setNcfType(v)}>
                                    <SelectTrigger id="ncf-type"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(tiposDisponibles ?? []).map((t) => (
                                            <SelectItem key={t} value={t}>{NCF_TIPO_LABEL[t]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {ncfNeedsCustomerId && !customerIdIsValid && (
                                    <p className="text-xs text-destructive">
                                        Este tipo exige RNC (9 dígitos) o cédula (11) del cliente. Sin eso el
                                        comprobante se emite, pero la venta no se podrá reportar en el 607.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div>
                    <Label htmlFor="sale-notes">Notas de la Venta (Opcional)</Label>
                    <Textarea 
                        id="sale-notes"
                        placeholder="Ej: Número de serie, instrucciones especiales, etc."
                        value={saleNotes}
                        onChange={(e) => setSaleNotes(e.target.value)}
                        className='mt-2'
                    />
                </div>
            </div>
            </ScrollArea>

            <div className="flex flex-col border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4 text-center">Resumen del Pedido</h3>
                <ScrollArea className="h-48 pr-4 -mr-4">
                    <div className="space-y-4">
                    {activeCart.items.map((item) => {
                        const unitPrice = getEffectiveUnitPrice(item, activeCart.selectedCustomer);
                        const hasDiscount = unitPrice < item.product.price;
                        const isWholesale = item.product.wholesalePrice === unitPrice;
                        return (
                          <div key={item.cartItemId} className="grid grid-cols-[1fr_auto] gap-x-4 items-center">
                              <div>
                                  <p className="font-medium text-sm">{item.product.name}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-xs text-muted-foreground">
                                          {formatQtyCompact(item.quantity, item.product.unit)} x {formatCurrency(unitPrice)}
                                      </span>
                                      {hasDiscount && (
                                          <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium animate-pulse">
                                              {isWholesale ? 'Por Mayor' : 'Descuento'}
                                          </span>
                                      )}
                                  </div>
                              </div>
                              <p className="font-medium text-right">{formatCurrency(unitPrice * item.quantity)}</p>
                          </div>
                        );
                    })}
                    </div>
                </ScrollArea>
                <Separator className="my-4" />
                <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>{formatCurrency(subtotal)}</span>
                    </div>
                     {totalDiscount > 0 && (
                        <div className="flex justify-between text-green-600 font-medium">
                            <span>Descuento Total</span>
                            <span>-{formatCurrency(totalDiscount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {itbisIncluded ? `ITBIS incluido (${ITBIS_RATE * 100}%)` : `ITBIS (${ITBIS_RATE * 100}%)`}
                        </span>
                        <span>{formatCurrency(itbisAmount)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-bold text-lg">
                        <span>Total</span>
                        <span>{formatCurrency(total)}</span>
                    </div>
                </div>
            </div>
        </div>
        
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={guardandoVenta}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirmButtonAction} disabled={guardandoVenta || isCashPaymentInvalid || isCashBlocked || isRefPaymentInvalid || isCreditPaymentInvalid || isCreditAmountInvalid || isOverCreditLimit || isDownPaymentCashBlocked || isDownPaymentRefInvalid}>
            {guardandoVenta ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando venta...
              </>
            ) : paymentMethod === 'financing' ? 'Configurar Plan' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    <FinancingDialog
        isOpen={isFinancingOpen}
        onOpenChange={setFinancingOpen}
        totalAmount={total}
        availableCredit={availableCredit}
        onFinancingComplete={handleFinancingComplete}
    />
    </>
  );
}
