'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCart } from '@/context/cart-provider';
import { useQuotes } from '@/context/quotes-provider';
import { useAuth } from '@/context/auth-provider';
import { formatCurrency } from '@/lib/utils';
import { Loader2, FileText } from 'lucide-react';

interface CreateQuoteDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// Guarda el carrito activo como cotización (estado pendiente) y lo limpia.
export function CreateQuoteDialog({ isOpen, onOpenChange }: CreateQuoteDialogProps) {
  const { toast } = useToast();
  const { activeCart, subtotal, itbisAmount, total, clearCart } = useCart();
  const { addQuote } = useQuotes();
  const { appUser } = useAuth();

  const [validDays, setValidDays] = useState('15');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { setValidDays('15'); setNotes(''); }
  }, [isOpen]);

  const handleSave = async () => {
    if (!activeCart || activeCart.items.length === 0 || !appUser) return;
    setSaving(true);
    try {
      const days = Math.max(1, Number(validDays) || 15);
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + days);

      await addQuote(
        {
          customerId: activeCart.selectedCustomer?.id,
          customer: activeCart.selectedCustomer,
          status: 'pending',
          validUntil: validUntil.toISOString().slice(0, 10),
          subtotal,
          itbisAmount,
          total,
          notes: notes.trim() || undefined,
          userName: appUser.name,
          branchId: appUser.branch,
        },
        activeCart.items,
      );

      clearCart();
      onOpenChange(false);
      toast({
        title: 'Cotización guardada',
        description: `${formatCurrency(total)} para ${activeCart.selectedCustomer?.name ?? 'Cliente Genérico'} — válida ${days} días.`,
      });
    } catch (e: any) {
      toast({ title: 'No se pudo guardar la cotización', description: e?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!activeCart) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Guardar Cotización
          </DialogTitle>
          <DialogDescription>
            Cliente: <span className="font-semibold">{activeCart.selectedCustomer?.name ?? 'Cliente Genérico'}</span><br />
            {activeCart.items.length} artículo(s) — Total: <span className="font-semibold">{formatCurrency(total)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="quote-valid-days">Validez (días)</Label>
            <Input
              id="quote-valid-days"
              type="number"
              min={1}
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-notes">Notas (opcional)</Label>
            <Textarea
              id="quote-notes"
              placeholder="Ej: Precios sujetos a disponibilidad."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[70px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cotización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
