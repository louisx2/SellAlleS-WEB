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
import type { CajaSession, CajaCloseResult } from '@/lib/types';
import { Loader2 } from 'lucide-react';

// Cierre de caja a ciegas: el cajero cuenta y declara el efectivo, y al cerrar
// se le muestra el esperado (calculado por la base) y la diferencia.
export function CloseCajaDialog({ session, children }: { session: CajaSession; children: React.ReactNode }) {
  const { closeSession } = useCaja();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [declared, setDeclared] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CajaCloseResult | null>(null);

  useEffect(() => {
    if (open) { setDeclared(''); setNotes(''); setResult(null); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = Number(declared);
    if (declared === '' || value < 0) {
      toast({ title: 'Monto inválido', description: 'Indica el efectivo contado en la caja.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await closeSession(session.id, value, notes.trim() || undefined);
      setResult(r);
    } catch (err: any) {
      toast({ title: 'No se pudo cerrar la caja', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const diffColor = (d: number) =>
    Math.abs(d) < 0.01 ? 'text-emerald-600 dark:text-emerald-400'
      : d < 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400';
  const diffLabel = (d: number) =>
    Math.abs(d) < 0.01 ? 'Cuadra' : d < 0 ? 'Faltante' : 'Sobrante';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Caja cerrada</DialogTitle>
              <DialogDescription>Resumen del cierre.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Esperado en caja</span><span className="font-semibold">{formatCurrency(result.expected)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Declarado (contado)</span><span className="font-semibold">{formatCurrency(result.declared)}</span></div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">{diffLabel(result.difference)}</span>
                <span className={`font-bold ${diffColor(result.difference)}`}>{formatCurrency(Math.abs(result.difference))}</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>Listo</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Cerrar caja</DialogTitle>
              <DialogDescription>
                Cuenta el efectivo físico y declara el total. Se comparará con lo esperado.
                <br />Monto inicial: <span className="font-semibold">{formatCurrency(session.openingAmount)}</span>
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="close-declared">Efectivo contado</Label>
                  <Input
                    id="close-declared" type="number" step="0.01" min="0"
                    value={declared}
                    onChange={(e) => setDeclared(e.target.value === '' ? '' : Number(e.target.value))}
                    required
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close-notes">Notas (Opcional)</Label>
                  <Textarea id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: observaciones del cierre…" />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">Cancelar</Button>
                </DialogClose>
                <Button type="submit" disabled={saving || declared === ''}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Cerrar caja
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
