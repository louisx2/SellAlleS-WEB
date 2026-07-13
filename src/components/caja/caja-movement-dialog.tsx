'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCaja } from '@/context/caja-provider';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// Entrada/salida manual de efectivo de la caja abierta (retiros, depósitos,
// ajustes). No pasa por ventas ni abonos: es dinero que entra o sale directo.
export function CajaMovementDialog({ children }: { children: React.ReactNode }) {
  const { addMovement } = useCaja();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setType('out'); setAmount(''); setReason(''); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = Number(amount);
    if (value <= 0) {
      toast({ title: 'Monto inválido', description: 'El monto debe ser mayor que cero.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addMovement(type, value, reason.trim() || undefined);
      toast({
        title: 'Movimiento registrado',
        description: `${type === 'in' ? 'Entrada' : 'Salida'} de ${formatCurrency(value)}.`,
      });
      setOpen(false);
    } catch (err: any) {
      toast({ title: 'No se pudo registrar el movimiento', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Movimiento de efectivo</DialogTitle>
          <DialogDescription>Registra una entrada o salida de dinero de la caja.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mov-type">Tipo</Label>
                <Select value={type} onValueChange={(v: 'in' | 'out') => setType(v)}>
                  <SelectTrigger id="mov-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="out">Salida (retiro/gasto)</SelectItem>
                    <SelectItem value="in">Entrada (depósito)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mov-amount">Monto</Label>
                <Input
                  id="mov-amount" type="number" step="0.01" min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  required
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mov-reason">Motivo (Opcional)</Label>
              <Input id="mov-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: pago a mensajero, retiro del dueño…" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !amount || Number(amount) <= 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
