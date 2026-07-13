'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/lib/supabase/client';
import { rowToCoupon } from '@/lib/supabase/mappers';
import type { Coupon } from '@/lib/types';

interface CouponSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  customerId: string;
  onCouponSelected: (coupon: Coupon) => void;
}

export function CouponSelectorDialog({ isOpen, onOpenChange, customerId, onCouponSelected }: CouponSelectorDialogProps) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !customerId) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('coupons')
        .select('*')
        .eq('customer_id', customerId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at');
      setCoupons(data ? data.map(rowToCoupon) : []);
      setLoading(false);
    })();
  }, [isOpen, customerId]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cupones Disponibles</DialogTitle>
          <DialogDescription>
            Selecciona un cupón para esta venta. El descuento del premio se aplica a mano con el editor de precio.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-72">
          <div className="space-y-2 p-1">
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Cargando...</p>
            ) : coupons.length > 0 ? (
              coupons.map((coupon) => (
                <div
                  key={coupon.id}
                  className="p-3 border rounded-md cursor-pointer hover:bg-accent"
                  onClick={() => {
                    onCouponSelected(coupon);
                    onOpenChange(false);
                  }}
                >
                  <p className="font-mono text-sm font-semibold">{coupon.code}</p>
                  <p className="text-sm">{coupon.rewardDescription}</p>
                  <p className="text-xs text-muted-foreground">
                    Vence: {new Date(coupon.expiresAt).toLocaleDateString('es-DO')}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">Este cliente no tiene cupones activos.</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
