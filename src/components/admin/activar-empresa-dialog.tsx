'use client';

// Pasar una empresa de prueba a activa (solo super admin): plan, forma de
// pago, el día de la primera cuota y, si se le hace un descuento, el precio
// por sucursal y por cuántas cuotas. Todo va en activar_empresa (migración
// 20261123200000), que pone trial_ends_at el día anterior a la primera cuota:
// la cuenta cobra desde ahí. Antes se cambiaba el estado en Editar y, como la
// fecha de la prueba quedaba vieja, la empresa amanecía debiendo todos los
// meses desde que se le venció la prueba.

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtDate } from '@/components/admin/cobros-fila';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { BILLING_CYCLE_LABEL, planRatePerBranch, type BillingCycle } from '@/lib/subscription-pricing';
import {
  diasEntre, fechaLocal, finPrecioEspecial, hoyLocal, mesesDeCiclo, sumarMeses,
} from '@/lib/subscription-status';
import type { Company } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';

export interface PlanParaActivar {
  id: string;
  name: string;
  monthly_price?: number | string | null;
  annual_price_per_month?: number | string | null;
}

type Cuando = 'hoy' | 'fin_periodo' | 'otra';

const PLAN_PREFERIDO = 'Pro';

export function ActivarEmpresaDialog({ company, plans, planActualId, onClose, onDone }: {
  company: Company | null;
  plans: PlanParaActivar[];
  /** Plan que ya tiene asignado, si tiene. */
  planActualId?: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [planId, setPlanId] = useState('');
  const [ciclo, setCiclo] = useState<BillingCycle>('monthly');
  const [cuando, setCuando] = useState<Cuando>('hoy');
  const [otraFecha, setOtraFecha] = useState('');
  const [acordado, setAcordado] = useState('');
  const [conDescuento, setConDescuento] = useState(false);
  const [descuento, setDescuento] = useState('');
  const [cuotasDescuento, setCuotasDescuento] = useState('3');
  const [guardando, setGuardando] = useState(false);

  // Al abrir: el plan que ya tiene si cobra algo; si no, Pro.
  useEffect(() => {
    if (!company) return;
    const actual = plans.find((p) => p.id === planActualId);
    const cobra = (p?: PlanParaActivar) => !!p && (p.monthly_price == null || Number(p.monthly_price) > 0);
    setPlanId((cobra(actual) ? actual : plans.find((p) => p.name === PLAN_PREFERIDO) ?? plans[0])?.id ?? '');
    setCiclo('monthly');
    setCuando('hoy');
    setOtraFecha('');
    setAcordado('');
    setConDescuento(false);
    setDescuento('');
    setCuotasDescuento('3');
  }, [company, plans, planActualId]);

  const plan = plans.find((p) => p.id === planId);
  const tieneTarifa = planRatePerBranch(plan, 'monthly') != null;
  const tarifa = planRatePerBranch(plan, ciclo);
  const sucursales = Math.max((company?.branches ?? []).filter((b) => b.is_active).length, 1);
  const meses = mesesDeCiclo(tieneTarifa ? ciclo : 'monthly');
  const hoy = hoyLocal();
  const finPeriodo = sumarMeses(hoy, meses);
  const primerCobro = cuando === 'hoy' ? hoy : cuando === 'fin_periodo' ? finPeriodo : otraFecha;
  const finPrueba = company?.trial_ends_at ? fechaLocal(company.trial_ends_at) : null;

  const precioEspecial = conDescuento && tieneTarifa && descuento !== '' ? Number(descuento) : null;
  const nCuotas = Math.max(parseInt(cuotasDescuento, 10) || 0, 0);
  const hastaEspecial = precioEspecial != null && nCuotas > 0 && primerCobro
    ? finPrecioEspecial(primerCobro, nCuotas, ciclo)
    : null;

  // Lo que se le cobra en la primera cuota y después.
  const resumen = useMemo(() => {
    if (!plan || !primerCobro) return null;
    if (!tieneTarifa) {
      const m = Number(acordado);
      return acordado && m > 0 ? { primera: m, luego: null as number | null } : null;
    }
    const porSucursal = precioEspecial ?? tarifa ?? 0;
    return {
      primera: porSucursal * sucursales * meses,
      luego: precioEspecial != null ? (tarifa ?? 0) * sucursales * meses : null,
    };
  }, [plan, primerCobro, tieneTarifa, acordado, precioEspecial, tarifa, sucursales, meses]);

  const atrasado = primerCobro && primerCobro < hoy ? diasEntre(primerCobro, hoy) : 0;
  const opcion = (v: Cuando) => cn(
    'flex cursor-pointer items-start gap-2 rounded-md border p-2.5',
    cuando === v && 'border-primary bg-primary/5',
  );

  const error = !planId ? 'Elija el plan.'
    : !primerCobro ? 'Elija el día de la primera cuota.'
    : !tieneTarifa && !(Number(acordado) > 0) ? 'Escriba el monto mensual acordado.'
    : conDescuento && tieneTarifa && (descuento === '' || Number(descuento) < 0) ? 'Escriba el precio especial.'
    : conDescuento && tieneTarifa && nCuotas < 1 ? 'Indique por cuántas cuotas vale el precio especial.'
    : null;

  const activar = async () => {
    if (!company || error) return;
    setGuardando(true);
    const { error: e } = await supabase.rpc('activar_empresa', {
      p_company_id: company.id,
      p_plan_id: planId,
      p_ciclo: tieneTarifa ? ciclo : 'monthly',
      p_primer_cobro: primerCobro,
      p_precio_acordado: tieneTarifa ? null : Number(acordado),
      p_precio_especial: precioEspecial,
      p_especial_cuotas: precioEspecial != null ? nCuotas : null,
    });
    setGuardando(false);
    if (e) {
      toast({ title: 'No se pudo activar', description: e.message, variant: 'destructive' });
      return;
    }
    toast({
      title: `${company.name} está activa`,
      description: `Primera cuota el ${fmtDate(primerCobro)}${resumen ? `: ${formatCurrency(resumen.primera)}` : ''}. Lo ve al recargar la app.`,
    });
    await onDone();
    onClose();
  };

  return (
    <Dialog open={!!company} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activar {company?.name}</DialogTitle>
          <DialogDescription>
            Deja de estar en prueba y empieza a pagar.
            {finPrueba && (finPrueba < hoy
              ? ` La prueba terminó el ${fmtDate(finPrueba)}.`
              : ` La prueba termina el ${fmtDate(finPrueba)}.`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Elija el plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {tieneTarifa ? (
              <div className="grid gap-2">
                <Label>Forma de pago</Label>
                <Select value={ciclo} onValueChange={(v) => setCiclo(v as BillingCycle)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(BILLING_CYCLE_LABEL) as BillingCycle[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {BILLING_CYCLE_LABEL[k]} ({formatCurrency(planRatePerBranch(plan, k) ?? 0)}/mes)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="ae-acordado">Monto mensual acordado</Label>
                <Input
                  id="ae-acordado" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Ej: 3500"
                  value={acordado} onChange={(e) => setAcordado(e.target.value)}
                />
              </div>
            )}
          </div>
          {tieneTarifa && (
            <p className="-mt-3 text-xs text-muted-foreground">
              {formatCurrency(tarifa ?? 0)} al mes por sucursal activa ({sucursales}).
            </p>
          )}

          <div className="space-y-2">
            <Label>Primera cuota</Label>
            <RadioGroup value={cuando} onValueChange={(v) => setCuando(v as Cuando)} className="gap-2">
              <label className={opcion('hoy')}>
                <RadioGroupItem value="hoy" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Hoy, {fmtDate(hoy)}</span>
                  <span className="block text-xs text-muted-foreground">Paga por adelantado, como las demás.</span>
                </span>
              </label>
              <label className={opcion('fin_periodo')}>
                <RadioGroupItem value="fin_periodo" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Al final del primer {meses === 12 ? 'año' : 'mes'}, {fmtDate(finPeriodo)}</span>
                  <span className="block text-xs text-muted-foreground">Usa el primer período y lo paga al terminarlo.</span>
                </span>
              </label>
              <label className={opcion('otra')}>
                <RadioGroupItem value="otra" className="mt-0.5" />
                <span className="flex-1 text-sm">
                  <span className="font-medium">Otra fecha</span>
                  {cuando === 'otra' && (
                    <Input
                      type="date" className="mt-1.5 h-8" value={otraFecha}
                      onChange={(e) => setOtraFecha(e.target.value)}
                    />
                  )}
                </span>
              </label>
            </RadioGroup>
            {atrasado > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Esa fecha ya pasó: amanece debiendo las cuotas desde el {fmtDate(primerCobro)}.
              </p>
            )}
          </div>

          {tieneTarifa && (
            <div className="space-y-3 rounded-md border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <Checkbox checked={conDescuento} onCheckedChange={(v) => setConDescuento(v === true)} />
                Precio especial al principio (descuento)
              </label>
              {conDescuento && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="ae-descuento" className="text-xs">Precio al mes por sucursal</Label>
                      <Input
                        id="ae-descuento" type="number" inputMode="decimal" min="0" step="0.01"
                        placeholder={formatCurrency(tarifa ?? 0)}
                        value={descuento} onChange={(e) => setDescuento(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="ae-cuotas" className="text-xs">Durante (cuotas)</Label>
                      <Input
                        id="ae-cuotas" type="number" inputMode="numeric" min="1" step="1"
                        value={cuotasDescuento} onChange={(e) => setCuotasDescuento(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hastaEspecial
                      ? `Vale hasta la cuota del ${fmtDate(hastaEspecial)}; desde la siguiente paga la tarifa del plan (${formatCurrency(tarifa ?? 0)}).`
                      : 'Después paga la tarifa del plan.'}
                    {' '}Se puede cambiar luego en Cobros.
                  </p>
                </>
              )}
            </div>
          )}

          {resumen && (
            <div className="rounded-md bg-muted/60 p-3 text-sm">
              <p>
                Primera cuota el <strong>{fmtDate(primerCobro)}</strong>: <strong>{formatCurrency(resumen.primera)}</strong>
                {meses === 12 ? ' (un año)' : ''}.
              </p>
              {resumen.luego != null && hastaEspecial && (
                <p className="text-muted-foreground">
                  Desde la del {fmtDate(sumarMeses(hastaEspecial, meses))}: {formatCurrency(resumen.luego)}.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={activar} disabled={guardando || !!error} title={error ?? undefined}>
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Activar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
