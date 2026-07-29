'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { supabase } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

// Tasas propias del módulo Préstamos — independientes de late_fee_rate/
// default_interest_rate (que siguen siendo solo de ventas a crédito/financiadas).
// Mismo patrón de guardado que FinancingSettingsCard: escribe directo en companies.
export function LoanSettingsCard() {
  const { toast } = useToast();
  const { reload: reloadProfile } = useCompanyProfile();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [lateFeeRate, setLateFeeRate] = useState('');
  const [defaultInterestRate, setDefaultInterestRate] = useState('');
  const [fundEnabled, setFundEnabled] = useState(false);
  const [blockOverdraft, setBlockOverdraft] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, loan_late_fee_rate, default_loan_interest_rate, loan_fund_enabled, loan_fund_block_overdraft')
      .limit(1)
      .maybeSingle();
    if (data) {
      setCompanyId(data.id);
      setLateFeeRate(String(data.loan_late_fee_rate ?? 5));
      setDefaultInterestRate(String(data.default_loan_interest_rate ?? 5));
      setFundEnabled(!!data.loan_fund_enabled);
      setBlockOverdraft(!!data.loan_fund_block_overdraft);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const fee = Number(lateFeeRate);
    const rate = Number(defaultInterestRate);
    if (!companyId || isNaN(fee) || fee < 0 || fee > 100 || isNaN(rate) || rate < 0 || rate > 100) {
      toast({
        title: 'Valores inválidos',
        description: 'Las tasas deben ser porcentajes entre 0 y 100.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({
        loan_late_fee_rate: fee,
        default_loan_interest_rate: rate,
        loan_fund_enabled: fundEnabled,
        loan_fund_block_overdraft: blockOverdraft,
      })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    // Estas columnas no pasan por updateProfile, así que hay que releer la
    // empresa: si no, encender el capital no se ve hasta recargar la página.
    await reloadProfile();
    toast({
      title: 'Préstamos actualizados',
      description: `Mora ${fee}% por cuota vencida · Interés sugerido ${rate}% mensual`
        + (fundEnabled ? ' · Capital disponible activado.' : '.'),
    });
  };

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Préstamos</CardTitle>
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
        <CardTitle>Préstamos</CardTitle>
        <CardDescription>
          Tasas por defecto para el módulo de préstamos de dinero, independientes de las de venta a crédito/financiamiento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="loan-late-fee-rate">Mora por cuota vencida (%)</Label>
            <Input
              id="loan-late-fee-rate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={lateFeeRate}
              onChange={(e) => setLateFeeRate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="default-loan-interest-rate">Interés mensual sugerido (%)</Label>
            <Input
              id="default-loan-interest-rate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={defaultInterestRate}
              onChange={(e) => setDefaultInterestRate(e.target.value)}
            />
          </div>
        </div>
        <Separator />

        {/* Opcional: apagado, el módulo no enseña nada de capital y se comporta
            como antes de que esto existiera. */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="loan-fund-enabled">Llevar el capital disponible</Label>
            <p className="text-sm text-muted-foreground">
              Muestra cuánto dinero te queda para prestar. Se calcula solo: lo que aportas, menos lo
              que retiras y lo que prestas, más lo que cobras.
            </p>
          </div>
          <Switch id="loan-fund-enabled" checked={fundEnabled} onCheckedChange={setFundEnabled} />
        </div>

        {fundEnabled && (
          <div className="flex items-start justify-between gap-4 pl-4 border-l-2">
            <div className="space-y-0.5">
              <Label htmlFor="loan-fund-block">Bloquear si no alcanza</Label>
              <p className="text-sm text-muted-foreground">
                Impide crear el préstamo cuando pasa lo disponible. Apagado (recomendado) solo avisa:
                no te traba si metiste dinero y aún no lo registraste.
              </p>
            </div>
            <Switch id="loan-fund-block" checked={blockOverdraft} onCheckedChange={setBlockOverdraft} />
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Tasas
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
