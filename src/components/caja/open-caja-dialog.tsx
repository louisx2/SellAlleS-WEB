'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCaja } from '@/context/caja-provider';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// Apertura de caja: monto inicial con el que arranca la gaveta.
export function OpenCajaDialog({ children }: { children: React.ReactNode }) {
  const { openSession } = useCaja();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setAmount(''); setNotes(''); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = Number(amount);
    if (value < 0 || amount === '') {
      toast({ title: 'Monto inválido', description: 'Indica el monto inicial de la caja.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await openSession(value, notes.trim() || undefined);
      toast({ title: 'Caja abierta', description: `Monto inicial: ${formatCurrency(value)}.` });
      setOpen(false);
    } catch (err: any) {
      toast({ title: 'No se pudo abrir la caja', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir caja</DialogTitle>
          <DialogDescription>Cuenta el efectivo con el que arranca la caja e ingrésalo como monto inicial.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="open-amount">Monto inicial</Label>
              <Input
                id="open-amount" type="number" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                required
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="open-notes">Notas (Opcional)</Label>
              <Textarea id="open-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: turno mañana, cajero de relevo…" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={saving || amount === ''}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Abrir caja
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
