'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import {
  FREQUENCY_LABEL,
  INTEREST_MODE_LABEL,
  type InterestMode,
  type PaymentFrequency,
} from '@/lib/frequency';
import { LateFeeFields, lateFeeSummary, parseLateFeeForm } from '@/components/credit/late-fee-fields';
import type { LateFeeMode } from '@/lib/late-fee';
import { Loader2 } from 'lucide-react';

// Tasas y valores por defecto del financiamiento de la empresa. Guardado propio
// (fuera del form del perfil): escribe directo en companies, igual que
// NcfSettingsCard.
//
// Estos son los valores de TODA la cuenta. Cada sucursal puede sobrescribirlos
// desde su propio diálogo (Sucursales → editar → Financiamiento); lo que la
// sucursal deje vacío hereda lo de aquí.
export function FinancingSettingsCard() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [lateFeeRate, setLateFeeRate] = useState('');
  const [lateFeeMode, setLateFeeMode] = useState<LateFeeMode>('once');
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState('0');
  const [lateFeeMaxRate, setLateFeeMaxRate] = useState('0');
  const [defaultInterestRate, setDefaultInterestRate] = useState('');
  const [interestMode, setInterestMode] = useState<InterestMode>('monthly_prorated');
  const [frequency, setFrequency] = useState<PaymentFrequency>('monthly');
  const [installments, setInstallments] = useState('12');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, late_fee_rate, late_fee_mode, late_fee_grace_days, late_fee_max_rate, default_interest_rate, financing_interest_mode, financing_default_frequency, financing_default_installments')
      .limit(1)
      .maybeSingle();
    if (data) {
      setCompanyId(data.id);
      setLateFeeRate(String(data.late_fee_rate ?? 5));
      setLateFeeMode((data.late_fee_mode ?? 'once') as LateFeeMode);
      setLateFeeGraceDays(String(data.late_fee_grace_days ?? 0));
      setLateFeeMaxRate(String(data.late_fee_max_rate ?? 0));
      setDefaultInterestRate(String(data.default_interest_rate ?? 3.5));
      setInterestMode((data.financing_interest_mode ?? 'monthly_prorated') as InterestMode);
      setFrequency((data.financing_default_frequency ?? 'monthly') as PaymentFrequency);
      setInstallments(String(data.financing_default_installments ?? 12));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const rate = Number(defaultInterestRate);
    const n = Number(installments);
    const mora = parseLateFeeForm(lateFeeRate, lateFeeMode, lateFeeGraceDays, lateFeeMaxRate);
    if (!companyId || isNaN(rate) || rate < 0 || rate > 100) {
      toast({
        title: 'Valores inválidos',
        description: 'Las tasas deben ser porcentajes entre 0 y 100.',
        variant: 'destructive',
      });
      return;
    }
    if (!mora.ok) {
      toast({ title: 'Mora inválida', description: mora.error, variant: 'destructive' });
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      toast({
        title: 'Cuotas inválidas',
        description: 'La cantidad de cuotas por defecto debe ir de 1 a 60.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({
        late_fee_rate: mora.rate,
        late_fee_mode: mora.mode,
        late_fee_grace_days: mora.graceDays,
        late_fee_max_rate: mora.maxRate,
        default_interest_rate: rate,
        financing_interest_mode: interestMode,
        financing_default_frequency: frequency,
        financing_default_installments: n,
      })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Financiamiento actualizado',
      description: `${lateFeeSummary(mora.rate, mora.mode, mora.graceDays, mora.maxRate)} · ${n} cuotas al ${rate}% (${FREQUENCY_LABEL[frequency]}).`,
    });
  };

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Crédito y Financiamiento</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crédito y Financiamiento</CardTitle>
        <CardDescription>
          La mora se cobra antes que el capital y queda congelada en cada venta: cambiarla aquí
          solo afecta a lo que se financie de ahora en adelante, nunca a una deuda que ya está
          corriendo. Lo demás son los valores con los que abre el POS al financiar una venta: el
          cajero puede cambiarlos, y cada sucursal puede tener los suyos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LateFeeFields
          idPrefix="company-late-fee"
          rate={lateFeeRate}
          onRateChange={setLateFeeRate}
          mode={lateFeeMode}
          onModeChange={(m) => setLateFeeMode(m as LateFeeMode)}
          graceDays={lateFeeGraceDays}
          onGraceDaysChange={setLateFeeGraceDays}
          maxRate={lateFeeMaxRate}
          onMaxRateChange={setLateFeeMaxRate}
          frequency={frequency}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="default-interest-rate">Interés sugerido (%)</Label>
            <Input
              id="default-interest-rate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={defaultInterestRate}
              onChange={(e) => setDefaultInterestRate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="company-interest-mode">Cómo se cobra el interés</Label>
          <Select value={interestMode} onValueChange={(v: InterestMode) => setInterestMode(v)}>
            <SelectTrigger id="company-interest-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly_prorated">{INTEREST_MODE_LABEL.monthly_prorated}</SelectItem>
              <SelectItem value="per_installment">{INTEREST_MODE_LABEL.per_installment}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {interestMode === 'monthly_prorated'
              ? 'La tasa es mensual y se reparte según lo que dure el plan: 12 cuotas quincenales cobran 6 meses de interés.'
              : 'Cada cuota cobra la tasa completa, sin importar cada cuánto se pague: 12 cuotas quincenales cobran 12 veces la tasa.'}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="company-frequency">Frecuencia por defecto</Label>
            <Select value={frequency} onValueChange={(v: PaymentFrequency) => setFrequency(v)}>
              <SelectTrigger id="company-frequency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">{FREQUENCY_LABEL.weekly}</SelectItem>
                <SelectItem value="biweekly">{FREQUENCY_LABEL.biweekly}</SelectItem>
                <SelectItem value="monthly">{FREQUENCY_LABEL.monthly}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="company-installments">Cuotas por defecto</Label>
            <Input
              id="company-installments"
              type="number"
              min="1"
              max="60"
              step="1"
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
