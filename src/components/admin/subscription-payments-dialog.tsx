'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { rowToSubscriptionPayment } from '@/lib/supabase/mappers';
import type { SubscriptionPayment, Company } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Loader2, PlusCircle } from 'lucide-react';

const METHOD_LABEL: Record<string, string> = {
  transfer: 'Transferencia', cash: 'Efectivo', card: 'Tarjeta', other: 'Otro',
};
const fmtDate = (s?: string | null) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-DO') : '—');
const today = () => new Date().toISOString().slice(0, 10);
// Suma meses a una fecha yyyy-mm-dd y devuelve yyyy-mm-dd.
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

interface Props {
  company: Company | null;
  defaultPlanName?: string;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras registrar un pago (para refrescar el listado de empresas). */
  onRecorded?: () => void;
}

export function SubscriptionPaymentsDialog({ company, defaultPlanName, onOpenChange, onRecorded }: Props) {
  const { toast } = useToast();
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState<number | ''>('');
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState<'transfer' | 'cash' | 'card' | 'other'>('transfer');
  const [reference, setReference] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [planName, setPlanName] = useState('');
  const [notes, setNotes] = useState('');
  const [activate, setActivate] = useState(true);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('subscription_payments')
      .select('*')
      .eq('company_id', company.id)
      .order('paid_at', { ascending: false });
    if (!error && data) setPayments(data.map(rowToSubscriptionPayment));
    setLoading(false);
  }, [company]);

  useEffect(() => {
    if (company) {
      load();
      setShowForm(false);
      setAmount(''); setPaidAt(today()); setMethod('transfer'); setReference('');
      setPeriodStart(''); setPeriodEnd(''); setPlanName(defaultPlanName ?? ''); setNotes(''); setActivate(true);
    }
  }, [company, defaultPlanName, load]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!company) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      toast({ title: 'Monto inválido', description: 'Indica el monto del pago.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_subscription_payment', {
        p_company_id: company.id,
        p_amount: value,
        p_paid_at: paidAt || today(),
        p_method: method,
        p_reference: reference.trim() || null,
        p_period_start: periodStart || null,
        p_period_end: periodEnd || null,
        p_plan_name: planName.trim() || null,
        p_notes: notes.trim() || null,
        p_activate: activate,
      });
      if (error) throw error;
      toast({
        title: 'Pago registrado',
        description: activate ? `${company.name}: pago registrado y empresa activada.` : `${company.name}: pago registrado.`,
      });
      setShowForm(false);
      await load();
      onRecorded?.();
    } catch (err: any) {
      toast({ title: 'No se pudo registrar el pago', description: err?.message ?? 'Error de conexión.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={company !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagos de suscripción — {company?.name}</DialogTitle>
          <DialogDescription>
            Historial de pagos y registro de nuevos pagos por transferencia.
            {company?.paid_until && <> · Pagado hasta el <strong>{fmtDate(company.paid_until)}</strong>.</>}
          </DialogDescription>
        </DialogHeader>

        {!showForm && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowForm(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Registrar pago
            </Button>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="sp-amount">Monto *</Label>
                <Input id="sp-amount" type="number" step="0.01" min="0" value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} required autoFocus placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-paid">Fecha de pago *</Label>
                <Input id="sp-paid" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="sp-method">Método</Label>
                <Select value={method} onValueChange={(v: 'transfer' | 'cash' | 'card' | 'other') => setMethod(v)}>
                  <SelectTrigger id="sp-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="other">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-ref">Referencia</Label>
                <Input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. de transferencia" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Período a cubrir (pago adelantado)</Label>
              <div className="flex flex-wrap gap-2">
                {[1, 3, 6, 12].map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Arranca desde el "pagado hasta" vigente (si es futuro) o desde hoy.
                      const base = company?.paid_until && company.paid_until >= today() ? company.paid_until : today();
                      setPeriodStart(base);
                      setPeriodEnd(addMonths(base, m));
                    }}
                  >
                    {m === 12 ? '1 año' : `${m} ${m === 1 ? 'mes' : 'meses'}`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="sp-ps">Período desde</Label>
                <Input id="sp-ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-pe">Período hasta (pagado hasta)</Label>
                <Input id="sp-pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-plan">Plan</Label>
              <Input id="sp-plan" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Ej: Pro" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sp-notes">Notas</Label>
              <Textarea id="sp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="sp-activate" className="font-normal">Activar la empresa (pasa a estado Activa)</Label>
              <Switch id="sp-activate" checked={activate} onCheckedChange={setActivate} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving || !amount}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar pago
              </Button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Cargando…</p>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin pagos registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Registró</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(p.paidAt)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                    <TableCell>{METHOD_LABEL[p.method] ?? p.method}</TableCell>
                    <TableCell className="text-muted-foreground">{p.reference || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {p.periodStart || p.periodEnd ? `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}` : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.recordedByName || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
