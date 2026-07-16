'use client';

import type { Sale } from '@/lib/types';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { formatCurrency, ITBIS_RATE } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

interface ReceiptProps {
  sale: Sale;
}

const ncfTypeText = {
    consumer: 'Consumidor Final',
    fiscal: 'Crédito Fiscal',
}

const paymentMethodText = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  credit: 'Crédito',
  financing: 'Financiamiento'
};

export function ReceiptHeader({ sale }: ReceiptProps) {
  const { profile } = useCompanyProfile();
  return (
    <div className="text-left space-y-1">
      {profile.ticketLogoUrl && (
        <div className="flex justify-center pb-1">
          <img src={profile.ticketLogoUrl} alt="" style={{ maxHeight: 60, maxWidth: '80%', objectFit: 'contain' }} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-center">{profile.name}</h3>
       <div className="text-xs text-muted-foreground text-center">
        <p>{profile.address}</p>
        <p>RNC: {profile.rnc}</p>
        <p>Tel: {profile.phone}</p>
      </div>
      <Separator className="my-2" />
      <div className="text-sm pt-1">
        <p className="text-left text-xs font-semibold uppercase">Recibo de Venta</p>
        <p className="text-left text-xs uppercase">ID: {sale.id}</p>
        <p className="text-left text-xs uppercase">Fecha: {new Date(sale.createdAt).toLocaleString('es-DO')}</p>
        <p className="text-left text-xs uppercase">Sucursal: {sale.branchId}</p>
        {sale.userName && <p className="text-left text-xs uppercase">Le atendió: {sale.userName}</p>}
      </div>
       <Separator className="my-2" />
       <div className="text-left pt-1 text-xs">
          <p className="font-semibold uppercase">CLIENTE: {sale.customer?.name ?? 'Cliente Genérico'}</p>
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
    return (
        <div className="space-y-3 font-mono text-xs py-3 border-t border-b border-dashed border-foreground/50">
            {sale.items.map(item => {
              const price = item.customPrice ?? item.product.price;
              const originalPrice = item.product.price;
              const hasDiscount = item.customPrice !== undefined && item.customPrice < originalPrice;
              const itemSubtotal = price * item.quantity;
              const itemItbis = item.product.itbis ? itemSubtotal * ITBIS_RATE : 0;
              const itemDiscountAmount = hasDiscount ? (originalPrice - (item.customPrice ?? 0)) * item.quantity : 0;

              return (
                <div key={item.cartItemId}>
                  <p>{item.product.name}</p>
                  <div className="flex justify-between pl-2">
                    <span>{item.quantity} x {formatCurrency(price)}</span>
                    <span>{formatCurrency(itemSubtotal)}</span>
                  </div>
                   {hasDiscount && (
                      <div className="flex justify-between text-green-600 pl-2">
                          <span>Desc.</span>
                          <span>-{formatCurrency(itemDiscountAmount)}</span>
                      </div>
                  )}
                  {item.product.itbis && (
                    <div className="flex justify-between text-muted-foreground pl-2">
                        <span>ITBIS</span>
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
  const totalItems = sale.items.reduce((acc, item) => acc + item.quantity, 0);
  const totalDiscount = sale.items.reduce((acc, item) => {
    const originalPrice = item.product.price;
    if (item.customPrice !== undefined && item.customPrice < originalPrice) {
      return acc + (originalPrice - item.customPrice) * item.quantity;
    }
    return acc;
  }, 0);

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
              <span>{totalItems}</span>
          </div>
          <div className="flex justify-between">
              <span className="uppercase">Subtotal:</span>
              <span>{formatCurrency(sale.subtotal)}</span>
          </div>
          {totalDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                  <span className="uppercase">Descuentos:</span>
                  <span>-{formatCurrency(totalDiscount)}</span>
              </div>
          )}
          <div className="flex justify-between">
              <span className="uppercase">ITBIS Total:</span>
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
  const { profile } = useCompanyProfile();

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
        <p className="text-center mt-3 text-xs font-semibold">{profile.receiptFooter}</p>
        <div className="text-center text-xs mt-1">
          {profile.socialMedia.instagram && <span>{profile.socialMedia.instagram}</span>}
          {profile.socialMedia.instagram && profile.socialMedia.facebook && <span> • </span>}
          {profile.socialMedia.facebook && <span>{profile.socialMedia.facebook}</span>}
        </div>
        <div className="text-center mt-6 pt-2 border-t border-dashed">
          <p className="text-[10px] text-muted-foreground font-mono">
            SellAlleS Web <span className="opacity-70">by SmatCore</span>
          </p>
        </div>
    </div>
  );
}
