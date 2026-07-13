'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

// Tasas propias del módulo Préstamos — independientes de late_fee_rate/
// default_interest_rate (que siguen siendo solo de ventas a crédito/financiadas).
// Mismo patrón de guardado que FinancingSettingsCard: escribe directo en companies.
export function LoanSettingsCard() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [lateFeeRate, setLateFeeRate] = useState('');
  const [defaultInterestRate, setDefaultInterestRate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, loan_late_fee_rate, default_loan_interest_rate')
      .limit(1)
      .maybeSingle();
    if (data) {
      setCompanyId(data.id);
      setLateFeeRate(String(data.loan_late_fee_rate ?? 5));
      setDefaultInterestRate(String(data.default_loan_interest_rate ?? 5));
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
      .update({ loan_late_fee_rate: fee, default_loan_interest_rate: rate })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Tasas actualizadas',
      description: `Mora ${fee}% por cuota vencida · Interés sugerido ${rate}% mensual.`,
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
