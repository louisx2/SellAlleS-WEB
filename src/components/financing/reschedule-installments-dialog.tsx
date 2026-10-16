'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useSales } from '@/context/sales-provider';
import { cn } from '@/lib/utils';
import { overdueDays } from '@/lib/late-fee';
import { parseYmd, previewReschedule, rescheduleError, toYmd } from '@/lib/financing-schedule';
import type { Sale } from '@/lib/types';

interface RescheduleInstallmentsDialogProps {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Días de gracia del plan: deciden si mover una cuota le quita o le pone mora. */
  graceDays: number;
}

const fmt = (ymd: string) => parseYmd(ymd).toLocaleDateString('es-DO');

/** "Las cuotas 1, 2 y 3". */
const listCuotas = (nums: number[]) => `Las cuotas ${nums.slice(0, -1).join(', ')} y ${nums[nums.length - 1]}`;

// Cambiar la fecha de pago de las cuotas que faltan: una prórroga, o el cliente
// que pasó a cobrar otro día. Antes de guardar se ve cómo queda cada cuota; la
// base vuelve a validar todo y deja el rastro de quién lo cambió y por qué.
// Se monta al abrir, así cada vez arranca en la primera cuota sin pagar.
export function RescheduleInstallmentsDialog({ sale, open, onOpenChange, graceDays }: RescheduleInstallmentsDialogProps) {
  const { rescheduleInstallments } = useSales();
  const { toast } = useToast();
  // Solo el plan vigente, como la base: en un plan refinanciado las cuotas
  // viejas ya están pagadas y, si se pagaron por adelantado, vencen después
  // que las nuevas — compararlas haría imposible mover ninguna.
  const firstInstallment = sale.financingDetails?.firstInstallment ?? 1;
  const installments = useMemo(
    () => (sale.installments ?? []).filter((i) => i.number >= firstInstallment),
    [sale.installments, firstInstallment],
  );
  const unpaid = installments.filter((i) => i.status !== 'paid');
  const frequency = sale.financingDetails?.frequency ?? 'monthly';
  const saleDay = toYmd(new Date(sale.createdAt));

  const [target, setTarget] = useState<number>(unpaid[0]?.number ?? 1);
  const [newDate, setNewDate] = useState(unpaid[0]?.dueDate ?? '');
  const [shiftFollowing, setShiftFollowing] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () => previewReschedule(installments, frequency, target, newDate, shiftFollowing),
    [installments, frequency, target, newDate, shiftFollowing],
  );
  const error = rescheduleError(rows, target, saleDay);
  const changed = rows.filter((r) => r.after !== r.before);
  const hasFollowing = unpaid.some((i) => i.number > target);

  // La mora se calcula desde la fecha de la cuota: moverla cambia lo que debe.
  const today = new Date();
  const isLate = (ymd: string) => overdueDays(ymd, today, graceDays) > 0;
  const moved = changed.filter((r) => r.after);
  const stopsLate = moved.filter((r) => isLate(r.before) && !isLate(r.after)).map((r) => r.number);
  const startsLate = moved.filter((r) => !isLate(r.before) && isLate(r.after)).map((r) => r.number);
  const lateFeeNotes = [
    stopsLate.length === 1 &&
      `La cuota ${stopsLate[0]} está vencida: con la fecha nueva deja de cobrar mora. La mora ya cobrada no cambia.`,
    stopsLate.length > 1 &&
      `${listCuotas(stopsLate)} están vencidas: con la fecha nueva dejan de cobrar mora. La mora ya cobrada no cambia.`,
    startsLate.length === 1 &&
      `Con la fecha nueva, la cuota ${startsLate[0]} queda vencida y empieza a cobrar mora.`,
    startsLate.length > 1 &&
      `Con la fecha nueva, ${listCuotas(startsLate).toLowerCase()} quedan vencidas y empiezan a cobrar mora.`,
  ].filter(Boolean) as string[];

  const selectTarget = (value: string) => {
    const n = Number(value);
    setTarget(n);
    setNewDate(installments.find((i) => i.number === n)?.dueDate ?? '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const n = await rescheduleInstallments(sale.id, target, newDate, shiftFollowing && hasFollowing, reason);
      toast({
        title: 'Fechas actualizadas',
        description: n === 1 ? 'Se cambió la fecha de 1 cuota.' : `Se cambió la fecha de ${n} cuotas.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'No se pudieron cambiar las fechas',
        description: e?.message ?? 'Error de conexión con el servidor.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cambiar fechas de pago</DialogTitle>
          <DialogDescription>
            Solo se pueden mover las cuotas que no están pagadas. Las fechas tienen que quedar en orden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reschedule-target">Cuota</Label>
              <Select value={String(target)} onValueChange={selectTarget}>
                <SelectTrigger id="reschedule-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {unpaid.map((i) => (
                    <SelectItem key={i.id} value={String(i.number)}>
                      Cuota {i.number} — {fmt(i.dueDate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reschedule-date">Nueva fecha</Label>
              <Input
                id="reschedule-date"
                type="date"
                value={newDate}
                min={saleDay}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
          </div>

          {hasFollowing && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="reschedule-shift"
                checked={shiftFollowing}
                onCheckedChange={(v) => setShiftFollowing(v === true)}
              />
              <Label htmlFor="reschedule-shift" className="font-normal">
                Mover también las cuotas siguientes
              </Label>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Fecha actual</TableHead>
                  <TableHead>Fecha nueva</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const moved = r.after !== r.before;
                  return (
                    <TableRow key={r.number} className={r.status === 'paid' ? 'opacity-60' : undefined}>
                      <TableCell>{r.number}</TableCell>
                      <TableCell className={cn(moved && 'text-muted-foreground line-through')}>{fmt(r.before)}</TableCell>
                      <TableCell className={cn(moved && 'font-semibold text-primary')}>
                        {r.status === 'paid' ? 'Pagada' : r.after ? fmt(r.after) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {lateFeeNotes.length > 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-1">
              {lateFeeNotes.map((note) => <p key={note}>{note}</p>)}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reschedule-reason">Motivo (opcional)</Label>
            <Textarea
              id="reschedule-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: el cliente cobra los días 30"
            />
          </div>

          {error && changed.length > 0 && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !!error}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Guardar fechas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
