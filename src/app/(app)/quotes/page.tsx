'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useQuotes } from '@/context/quotes-provider';
import { useProducts } from '@/context/product-provider';
import { openQuoteCart } from '@/context/cart-provider';
import { formatCurrency } from '@/lib/utils';
import type { Quote, QuoteStatus, CartItem } from '@/lib/types';
import { ShoppingCart, Eye, FileText } from 'lucide-react';

const STATUS_LABEL: Record<QuoteStatus, string> = {
  pending: 'Pendiente',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  converted: 'Convertida',
};
const STATUS_VARIANT: Record<QuoteStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  sent: 'outline',
  accepted: 'default',
  rejected: 'destructive',
  converted: 'default',
};

const isExpired = (q: Quote) =>
  q.status !== 'converted' && !!q.validUntil && new Date(q.validUntil + 'T23:59:59') < new Date();

export default function QuotesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { quotes, updateQuoteStatus, reload, loading } = useQuotes();
  const { products } = useProducts();
  const [detail, setDetail] = useState<Quote | null>(null);

  // Refrescar al entrar (una conversión pudo ocurrir desde el POS).
  useEffect(() => { reload(); }, [reload]);

  const handleStatusChange = async (quote: Quote, status: QuoteStatus) => {
    try {
      await updateQuoteStatus(quote.id, status);
      toast({ title: 'Estado actualizado', description: `La cotización pasó a "${STATUS_LABEL[status]}".` });
    } catch (e: any) {
      toast({ title: 'No se pudo actualizar', description: e?.message, variant: 'destructive' });
    }
  };

  // Patrón del sistema de escritorio (PrecargarDesdeCotizacion): match exacto
  // por ID de producto y se respetan los precios cotizados.
  const loadIntoCart = (quote: Quote) => {
    const items: CartItem[] = [];
    const missing: string[] = [];

    for (const it of quote.items) {
      const product = products.find((p) => p.id === it.product.id);
      if (!product) {
        missing.push(it.product.name);
        continue;
      }
      const quotedPrice = it.customPrice ?? it.product.price;
      items.push({
        cartItemId: `item-${Date.now()}-${Math.random()}`,
        product,
        quantity: it.quantity,
        // Precio cotizado manda, aunque el precio de lista haya cambiado.
        customPrice: quotedPrice !== product.price ? quotedPrice : undefined,
      });
    }

    if (items.length === 0) {
      toast({
        title: 'No se pudo cargar',
        description: 'Ninguno de los productos cotizados existe ya en el inventario.',
        variant: 'destructive',
      });
      return;
    }

    const ok = openQuoteCart(items, quote.customer, quote.id);
    if (!ok) {
      toast({
        title: 'Carritos llenos',
        description: 'Cierra o cobra alguno de los carritos abiertos en el POS e inténtalo de nuevo.',
        variant: 'destructive',
      });
      return;
    }

    if (missing.length > 0) {
      toast({
        title: 'Algunos productos ya no existen',
        description: `No se cargaron: ${missing.join(', ')}.`,
      });
    }
    router.push('/pos');
  };

  return (
    <div>
      <PageHeader title="Cotizaciones" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Artículos</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Válida hasta</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              ) : quotes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    Aún no hay cotizaciones. Créalas desde el carrito del Punto de Venta.
                  </TableCell>
                </TableRow>
              ) : (
                quotes.map((q) => (
                  <TableRow key={q.id} className={isExpired(q) ? 'opacity-70' : undefined}>
                    <TableCell className="text-xs">{q.createdAt.toLocaleDateString('es-DO')}</TableCell>
                    <TableCell className="font-medium">{q.customer?.name ?? 'Cliente Genérico'}</TableCell>
                    <TableCell>{q.items.length}</TableCell>
                    <TableCell className="font-semibold">{formatCurrency(q.total)}</TableCell>
                    <TableCell className="text-xs">
                      {q.validUntil ?? '—'}
                      {isExpired(q) && <Badge variant="destructive" className="ml-2 text-[10px]">Vencida</Badge>}
                    </TableCell>
                    <TableCell>
                      {q.status === 'converted' ? (
                        <Badge className="bg-green-600 hover:bg-green-600">Convertida</Badge>
                      ) : (
                        <Select value={q.status} onValueChange={(v: QuoteStatus) => handleStatusChange(q, v)}>
                          <SelectTrigger className="h-8 w-[130px]">
                            <SelectValue>
                              <Badge variant={STATUS_VARIANT[q.status]}>{STATUS_LABEL[q.status]}</Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="sent">Enviada</SelectItem>
                            <SelectItem value="accepted">Aceptada</SelectItem>
                            <SelectItem value="rejected">Rechazada</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(q)}>
                        <Eye className="mr-1 h-4 w-4" /> Ver
                      </Button>
                      {q.status !== 'converted' && q.status !== 'rejected' && (
                        <Button variant="ghost" size="sm" onClick={() => loadIntoCart(q)}>
                          <ShoppingCart className="mr-1 h-4 w-4" /> Al carrito
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cotización — {detail?.customer?.name ?? 'Cliente Genérico'}</DialogTitle>
            <DialogDescription>
              {detail?.createdAt.toLocaleString('es-DO')} · {detail && STATUS_LABEL[detail.status]}
              {detail?.userName ? ` · por ${detail.userName}` : ''}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="space-y-2">
                {detail.items.map((it) => {
                  const price = it.customPrice ?? it.product.price;
                  return (
                    <div key={it.cartItemId} className="flex justify-between gap-2">
                      <span>{it.quantity} × {it.product.name}</span>
                      <span className="font-medium">{formatCurrency(price * it.quantity)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(detail.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">ITBIS</span><span>{formatCurrency(detail.itbisAmount)}</span></div>
                <div className="flex justify-between font-bold"><span>Total</span><span>{formatCurrency(detail.total)}</span></div>
              </div>
              {detail.notes && <p className="text-xs text-muted-foreground border-t pt-2">Notas: {detail.notes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
