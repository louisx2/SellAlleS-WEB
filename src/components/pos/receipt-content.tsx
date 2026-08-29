'use client';

import type { Sale } from '@/lib/types';
import { useTicketProfile } from '@/hooks/use-ticket-profile';
import { formatCurrency, ITBIS_RATE } from '@/lib/utils';
import { formatQtyCompact } from '@/lib/units';
import { Separator } from '@/components/ui/separator';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { BusinessHeader, BusinessFooter, DocumentBarcode } from '@/components/print/business-header';

interface ReceiptProps {
  sale: Sale;
}

const ncfTypeText = {
    consumer: 'Consumidor Final',
    fiscal: 'Crédito Fiscal',
    gubernamental: 'Gubernamental',
    regimen_especial: 'Régimen Especial',
}

const paymentMethodText = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  financing: 'Financiamiento'
};

export function ReceiptHeader({ sale }: ReceiptProps) {
  // Perfil efectivo del ticket: datos de la sucursal donde se hizo la venta
  // (sale.branchId guarda el nombre), con herencia de la empresa por campo.
  const profile = useTicketProfile(sale.branchId);

  return (
    <div className="text-left space-y-1">
      {/* Compartido con el estado de cuenta: los dos documentos tienen que
          verse del mismo negocio. */}
      <BusinessHeader profile={profile} />
      <Separator className="my-2" />
      <div className="text-sm pt-1">
        <p className="text-left text-xs font-semibold uppercase">Recibo de Venta</p>
        <p className="text-left text-xs uppercase">ID: #{sale.id.slice(0, 8).toUpperCase()}</p>
        <p className="text-left text-xs uppercase">Fecha: {new Date(sale.createdAt).toLocaleString('es-DO')}</p>
        <p className="text-left text-xs uppercase">Sucursal: {sale.branchId}</p>
        {sale.userName && <p className="text-left text-xs uppercase">Le atendió: {sale.userName}</p>}
      </div>
       <Separator className="my-2" />
       <div className="text-left pt-1 text-xs">
          <p className="font-semibold uppercase">CLIENTE: {sale.customer?.name ?? 'Consumidor Final'}</p>
          {sale.customer?.rnc && <p><span className="font-semibold uppercase">RNC:</span> {sale.customer.rnc}</p>}
       </div>
       <Separator className="my-2" />
       <div className="text-left pt-1 text-xs">
          <p className="font-semibold uppercase">COMPROBANTE: {ncfTypeText[sale.ncfType]}</p>
          <p className="font-semibold uppercase">NCF: {sale.ncf ?? 'N/A'}</p>
       </div>
    </div>
  );
}

export function ReceiptItems({ sale }: ReceiptProps) {
    // Venta con precios ITBIS incluido: el impuesto se desglosa hacia adentro
    // (parte del precio), no se suma encima.
    const included = !!sale.itbisIncluded;
    return (
        <div className="space-y-3 font-mono text-xs py-3 border-t border-b border-dashed border-foreground/50">
            {sale.items.map(item => {
              const price = item.customPrice ?? item.product.price;
              const originalPrice = item.product.price;
              const hasDiscount = item.customPrice !== undefined && item.customPrice < originalPrice;
              // El renglón se imprime en bruto (precio de lista) y la rebaja se
              // resta aparte: impreso ya rebajado, la línea "Desc." se lee como
              // una segunda rebaja y el papel no cuadra contra el total.
              // Un precio manual por encima del de lista no es descuento: ahí el
              // bruto es lo que se cobró, si no el ticket mostraría de menos.
              const unitPrice = hasDiscount ? originalPrice : price;
              const itemGross = unitPrice * item.quantity;
              // El ITBIS es el que se cobró de verdad: sobre el precio rebajado.
              const itemCharged = price * item.quantity;
              const itemItbis = item.product.itbis
                ? (included ? itemCharged * ITBIS_RATE / (1 + ITBIS_RATE) : itemCharged * ITBIS_RATE)
                : 0;
              const itemDiscountAmount = hasDiscount ? (originalPrice - (item.customPrice ?? 0)) * item.quantity : 0;

              return (
                <div key={item.cartItemId}>
                  <p>{item.product.name}</p>
                  <div className="flex justify-between pl-2">
                    <span>{formatQtyCompact(item.quantity, item.product.unit)} x {formatCurrency(unitPrice)}</span>
                    <span>{formatCurrency(itemGross)}</span>
                  </div>
                   {hasDiscount && (
                      <div className="flex justify-between text-green-600 pl-2">
                          <span>Desc.</span>
                          <span>-{formatCurrency(itemDiscountAmount)}</span>
                      </div>
                  )}
                  {item.product.itbis && (
                    <div className="flex justify-between text-muted-foreground pl-2">
                        <span>{included ? 'ITBIS incl.' : 'ITBIS'}</span>
                        <span>{formatCurrency(itemItbis)}</span>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
    );
}

export function ReceiptTotals({ sale }: ReceiptProps) {
  // Renglones: sumar cantidades no cuenta artículos si se mezclan libras con
  // unidades ("Artículos: 4.7" no le dice nada al cliente).
  const totalLines = sale.items.length;
  const totalDiscount = sale.items.reduce((acc, item) => {
    const originalPrice = item.product.price;
    if (item.customPrice !== undefined && item.customPrice < originalPrice) {
      return acc + (originalPrice - item.customPrice) * item.quantity;
    }
    return acc;
  }, 0);

  // sale.subtotal se guarda ya neto de descuentos, así que imprimirlo tal cual
  // junto a la línea "Descuentos" no cuadra a la vista (7,800 - 75 ≠ 7,800).
  // El ticket lo muestra en bruto y deja que la resta lleve al total.
  const grossSubtotal = sale.subtotal + totalDiscount;

  const paymentMethodStyles = {
    cash: 'bg-green-100 border-green-600 text-green-800',
    card: 'bg-blue-100 border-blue-600 text-blue-800',
    transfer: 'bg-orange-100 border-orange-500 text-orange-800',
    credit: 'bg-red-100 border-red-500 text-red-800',
    financing: 'bg-purple-100 border-purple-600 text-purple-800',
  };

  return (
    <>
      <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
              <span className="uppercase font-medium">Total de Artículos:</span>
              <span>{totalLines}</span>
          </div>
          <div className="flex justify-between">
              <span className="uppercase">Subtotal:</span>
              <span>{formatCurrency(grossSubtotal)}</span>
          </div>
          {totalDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                  <span className="uppercase">Descuentos:</span>
                  <span>-{formatCurrency(totalDiscount)}</span>
              </div>
          )}
          <div className="flex justify-between">
              <span className="uppercase">{sale.itbisIncluded ? 'ITBIS Incluido:' : 'ITBIS Total:'}</span>
              <span>{formatCurrency(sale.itbisAmount)}</span>
          </div>
      </div>
      
      <Separator className="my-2 border-dashed" />
      <div className="flex justify-between items-baseline font-bold">
        <span className="text-base uppercase">TOTAL:</span>
        <span className="text-lg">{formatCurrency(sale.total)}</span>
      </div>

     <Separator className="my-2" />

     <div className="space-y-1 text-sm">
       <div className="flex justify-between items-center">
          <span className="uppercase">Método de Pago:</span>
          <Badge 
            variant="outline" 
            className={cn("capitalize font-semibold", paymentMethodStyles[sale.paymentMethod])}
          >
            {paymentMethodText[sale.paymentMethod]}
          </Badge>
       </div>
       {sale.paymentReference && (
          <div className="flex justify-between items-center">
              <span className="uppercase">Referencia:</span>
              <span>{sale.paymentReference}</span>
          </div>
       )}
       <div className="flex justify-between items-center">
          <span className="uppercase">Monto Pagado:</span>
          <span className="font-medium">{formatCurrency(sale.amountPaid)}</span>
       </div>
        <div className="flex justify-between items-center font-semibold">
            <span className="uppercase">Devolución:</span>
            <span>{formatCurrency(sale.paymentMethod === 'cash' ? Math.max(0, sale.amountPaid - sale.total) : 0)}</span>
        </div>
       {sale.paymentStatus !== 'paid' && (
          <div className="flex justify-between items-center font-bold text-red-600 mt-1">
              <span className="uppercase">BALANCE PENDIENTE:</span>
              <span>{formatCurrency(sale.total - sale.amountPaid)}</span>
          </div>
       )}
     </div>
    </>
  );
}


export function ReceiptContent({ sale }: ReceiptProps) {
  const profile = useTicketProfile(sale.branchId);

  return (
     <div className="space-y-4">
        <ReceiptHeader sale={sale} />
        <ReceiptItems sale={sale} />
        <div className="pt-2">
            <ReceiptTotals sale={sale} />
        </div>
        {sale.coupon && (
            <>
                <Separator className="my-2" />
                <div className="text-sm">
                    <p className="font-semibold mb-1 uppercase">Cupón Aplicado: {sale.coupon.code}</p>
                    <p className="text-xs text-muted-foreground">{sale.coupon.rewardDescription}</p>
                </div>
            </>
        )}
        {sale.notes && (
            <>
                <Separator className="my-2" />
                <div className="text-sm">
                    <p className="font-semibold mb-1 uppercase">NOTAS:</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{sale.notes}</p>
                </div>
            </>
        )}
        <BusinessFooter profile={profile} codigo={<DocumentBarcode valor={sale.id} />} />
    </div>
  );
}
