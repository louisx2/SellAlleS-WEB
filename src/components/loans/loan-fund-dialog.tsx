'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useLoans } from '@/context/loan-provider';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoanFundDialogProps {
  type: 'aporte' | 'retiro';
  children: React.ReactNode;
}

const TEXTO = {
  aporte: {
    title: 'Registrar aporte de capital',
    description: 'Dinero que metes al negocio de préstamos. Sube lo que tienes disponible para prestar.',
    label: 'Monto que aportas',
    placeholder: 'Ej: capital inicial, ganancia reinvertida…',
    action: 'Registrar aporte',
  },
  retiro: {
    title: 'Registrar retiro de capital',
    description: 'Dinero que sacas del negocio. Baja lo que tienes disponible para prestar.',
    label: 'Monto que retiras',
    placeholder: 'Ej: ganancia del mes, gasto personal…',
    action: 'Registrar retiro',
  },
} as const;

// Aportes y retiros: lo único del fondo que el sistema no puede deducir solo.
// Lo prestado y lo cobrado ya están registrados, así que el disponible sale de
// la resta (ver loan_fund_summary en la base).
export function LoanFundDialog({ type, children }: LoanFundDialogProps) {
  const { toast } = useToast();
  const { fund, addFundMovement } = useLoans();
  const t = TEXTO[type];

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setAmount(''); setReason(''); }
  }, [open]);

  const monto = Number(amount) || 0;
  const disponible = fund?.disponible ?? 0;
  // Retirar más de lo que hay no se bloquea: el efectivo puede estar en una
  // gaveta que el sistema no ve todavía. Se avisa y se deja seguir, para que el
  // número quede reflejando la realidad y no al revés.
  const retiroExcede = type === 'retiro' && monto > disponible;

  const handleSubmit = async () => {
    if (monto <= 0) return;
    setSaving(true);
    try {
      await addFundMovement(type, monto, reason);
      toast({
        title: type === 'aporte' ? 'Aporte registrado' : 'Retiro registrado',
        description: `${formatCurrency(monto)} — disponible actualizado.`,
      });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: 'No se pudo registrar',
        description: err?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="fund-amount">{t.label}</Label>
            <Input
              id="fund-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            {retiroExcede && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Estás retirando más de lo disponible ({formatCurrency(disponible)}). Se registra igual.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="fund-reason">Motivo (opcional)</Label>
            <Textarea
              id="fund-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.placeholder}
            />
          </div>

          <Separator />

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Disponible ahora</span>
            <span className="font-semibold">{formatCurrency(disponible)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Quedaría en</span>
            <span className="font-semibold">
              {formatCurrency(type === 'aporte' ? disponible + monto : disponible - monto)}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || monto <= 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
