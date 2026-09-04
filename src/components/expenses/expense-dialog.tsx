'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useExpenses } from '@/context/expense-provider';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useCaja } from '@/context/caja-provider';
import { EXPENSE_TYPES_606, PAYMENT_FORMS_606 } from '@/lib/dgii-606';
import type { Expense } from '@/lib/types';

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = editar; ausente = crear. */
  expense?: Expense;
}

const emptyForm = {
  description: '',
  amount: '',
  category: '',
  date: new Date().toISOString().slice(0, 10),
  rnc: '',
  ncf: '',
  expenseType: '',
  itbisAmount: '',
  isGoods: false,
  paymentForm: '01',
  paidFromCaja: false,
};

// Alta/edición de gastos. La sección fiscal (NCF, RNC, tipo 606) solo aparece
// en empresas formalizadas: con NCF el gasto entra al Formato 606.
export function ExpenseDialog({ open, onOpenChange, expense }: ExpenseDialogProps) {
  const { addExpense, updateExpense } = useExpenses();
  const { appUser } = useAuth();
  const { profile } = useCompanyProfile();
  // Solo tiene sentido preguntarlo donde hay una gaveta de la que sacar el
  // dinero: sucursal que usa caja y con una abierta ahora mismo.
  const { branchUsesCaja, isOpen: cajaIsOpen } = useCaja();
  const canPayFromCaja = branchUsesCaja === true && cajaIsOpen;
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [withNcf, setWithNcf] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setForm({
        description: expense.description,
        amount: String(expense.amount),
        category: expense.category,
        date: expense.date.toISOString().slice(0, 10),
        rnc: expense.rnc ?? '',
        ncf: expense.ncf ?? '',
        expenseType: expense.expenseType ?? '',
        itbisAmount: expense.itbisAmount ? String(expense.itbisAmount) : '',
        isGoods: expense.isGoods,
        paymentForm: expense.paymentForm ?? '01',
        paidFromCaja: expense.paidFromCaja,
      });
      setWithNcf(!!expense.ncf);
    } else {
      setForm(emptyForm);
      setWithNcf(false);
    }
  }, [open, expense]);

  const set = (patch: Partial<typeof emptyForm>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = async () => {
    const amount = Number(form.amount);
    const itbis = Number(form.itbisAmount || 0);
    if (!form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Datos incompletos', description: 'Descripción y monto mayor que cero son obligatorios.', variant: 'destructive' });
      return;
    }
    if (withNcf) {
      const rncDigits = form.rnc.replace(/\D/g, '');
      if (!/^[BE]\d{10,12}$/i.test(form.ncf.trim())) {
        toast({ title: 'NCF inválido', description: 'El NCF debe tener el formato B0100000001 (o e-CF).', variant: 'destructive' });
        return;
      }
      if (rncDigits.length !== 9 && rncDigits.length !== 11) {
        toast({ title: 'RNC/Cédula inválido', description: 'El RNC tiene 9 dígitos y la cédula 11.', variant: 'destructive' });
        return;
      }
      if (!form.expenseType) {
        toast({ title: 'Falta el tipo de gasto', description: 'Elige el tipo de bienes/servicios del 606.', variant: 'destructive' });
        return;
      }
      if (!Number.isFinite(itbis) || itbis < 0 || itbis >= amount) {
        toast({ title: 'ITBIS inválido', description: 'El ITBIS debe ser menor que el monto total del gasto.', variant: 'destructive' });
        return;
      }
    }

    const data: Omit<Expense, 'id'> = {
      description: form.description.trim(),
      amount,
      category: form.category.trim(),
      date: new Date(`${form.date}T12:00:00`),
      branchId: appUser?.branch ?? '',
      rnc: withNcf ? form.rnc : undefined,
      ncf: withNcf ? form.ncf : undefined,
      expenseType: withNcf ? form.expenseType : undefined,
      itbisAmount: withNcf ? itbis : 0,
      isGoods: withNcf ? form.isGoods : false,
      paymentForm: withNcf ? form.paymentForm : undefined,
      paidFromCaja: canPayFromCaja ? form.paidFromCaja : false,
      userName: appUser?.name,
    };

    setSaving(true);
    try {
      if (expense) await updateExpense(expense.id, data);
      else await addExpense(data);
      toast({ title: expense ? 'Gasto actualizado' : 'Gasto registrado' });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'No se pudo guardar el gasto',
        description: error?.message?.includes('expenses_company_rnc_ncf_key')
          ? 'Ya existe un gasto con ese NCF y ese RNC.'
          : error?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expense ? 'Editar gasto' : 'Nuevo gasto'}</DialogTitle>
          <DialogDescription>
            Registra el gasto en la sucursal {appUser?.branch || 'actual'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="exp-desc">Descripción</Label>
            <Input
              id="exp-desc"
              placeholder="Ej: Combustible camioneta"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="exp-amount">Monto (RD$)</Label>
              <Input
                id="exp-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp-date">Fecha</Label>
              <Input
                id="exp-date"
                type="date"
                value={form.date}
                onChange={(e) => e.target.value && set({ date: e.target.value })}
              />
            </div>
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label htmlFor="exp-cat">Categoría</Label>
              <Input
                id="exp-cat"
                placeholder="Ej: Transporte"
                value={form.category}
                onChange={(e) => set({ category: e.target.value })}
              />
            </div>
          </div>

          {canPayFromCaja && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5 pr-3">
                <Label htmlFor="exp-caja">Pagado desde la caja</Label>
                <p className="text-xs text-muted-foreground">
                  El dinero salió de la gaveta, así que el cierre lo resta del efectivo esperado.
                </p>
              </div>
              <Switch
                id="exp-caja"
                checked={form.paidFromCaja}
                onCheckedChange={(v) => set({ paidFromCaja: v })}
              />
            </div>
          )}

          {profile.isFormalized && (
            <div className="rounded-lg border p-3 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Comprobante fiscal (NCF)</p>
                  <p className="text-xs text-muted-foreground">
                    Con NCF, el gasto entra al Formato 606 del período.
                  </p>
                </div>
                <Switch checked={withNcf} onCheckedChange={setWithNcf} />
              </div>

              {withNcf && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="exp-ncf" className="text-xs">NCF</Label>
                      <Input
                        id="exp-ncf"
                        placeholder="B0100000123"
                        className="font-mono"
                        value={form.ncf}
                        onChange={(e) => set({ ncf: e.target.value.toUpperCase() })}
                        maxLength={13}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="exp-rnc" className="text-xs">RNC/Cédula del suplidor</Label>
                      <Input
                        id="exp-rnc"
                        placeholder="131234567"
                        value={form.rnc}
                        onChange={(e) => set({ rnc: e.target.value })}
                        maxLength={13}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de bienes/servicios (casilla 3)</Label>
                    <Select value={form.expenseType} onValueChange={(v) => set({ expenseType: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecciona el tipo" /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_TYPES_606.map((t) => (
                          <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="exp-itbis" className="text-xs">ITBIS incluido (RD$)</Label>
                      <Input
                        id="exp-itbis"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={form.itbisAmount}
                        onChange={(e) => set({ itbisAmount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Bienes o servicios</Label>
                      <Select
                        value={form.isGoods ? 'goods' : 'services'}
                        onValueChange={(v) => set({ isGoods: v === 'goods' })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="services">Servicios</SelectItem>
                          <SelectItem value="goods">Bienes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <Label className="text-xs">Forma de pago</Label>
                      <Select value={form.paymentForm} onValueChange={(v) => set({ paymentForm: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_FORMS_606.map((p) => (
                            <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {expense ? 'Guardar cambios' : 'Registrar gasto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
