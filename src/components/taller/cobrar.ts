'use client';

import { supabase } from '@/lib/supabase/client';
import { rowToServiceItem } from '@/lib/supabase/mappers';
import { openServiceCart } from '@/context/cart-provider';
import type { CartItem, Service } from '@/lib/types';

export type CobroResult = { ok: true } | { ok: false; error: string };

/** Abre en el POS un carrito con las líneas de la orden. Las líneas se leen de la
 *  base en este momento (no de la pantalla) para cobrar exactamente lo que hay. */
export async function abrirCobroDelCaso(service: Service): Promise<CobroResult> {
  const { data, error } = await supabase
    .from('service_items')
    .select('*, products(*)')
    .eq('service_id', service.id)
    .order('created_at');
  if (error) return { ok: false, error: error.message };
  const lines = (data ?? []).map(rowToServiceItem);
  if (lines.length === 0) return { ok: false, error: 'La orden no tiene nada que cobrar.' };

  const items: CartItem[] = lines.map((l) => ({
    cartItemId: `item-${l.id}`,
    product: l.product,
    quantity: l.quantity,
    // El precio de la orden manda sobre el de lista del artículo.
    ...(l.price !== l.product.price ? { customPrice: l.price } : {}),
    serviceItemId: l.id,
  }));

  const ok = openServiceCart(items, service.customer, service.id, service.number);
  if (!ok) {
    return { ok: false, error: 'Los carritos del POS están llenos. Cobra o cierra alguno e inténtalo de nuevo.' };
  }
  return { ok: true };
}
