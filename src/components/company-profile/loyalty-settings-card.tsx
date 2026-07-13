'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

// Configuración del programa de fidelidad. Guardado propio (fuera del form
// del perfil): escribe directo en companies, igual que FinancingSettingsCard.
export function LoyaltySettingsCard() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [purchasesRequired, setPurchasesRequired] = useState('');
  const [rewardDescription, setRewardDescription] = useState('');
  const [validDays, setValidDays] = useState('30');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, loyalty_enabled, loyalty_purchases_required, loyalty_reward_description, loyalty_coupon_valid_days')
      .limit(1)
      .maybeSingle();
    if (data) {
      setCompanyId(data.id);
      setEnabled(!!data.loyalty_enabled);
      setPurchasesRequired(data.loyalty_purchases_required != null ? String(data.loyalty_purchases_required) : '');
      setRewardDescription(data.loyalty_reward_description ?? '');
      setValidDays(String(data.loyalty_coupon_valid_days ?? 30));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const required = purchasesRequired.trim() ? Number(purchasesRequired) : null;
    const days = Number(validDays);

    if (!companyId) return;
    if (enabled && (!required || required <= 0)) {
      toast({
        title: 'Faltan datos',
        description: 'Indica cuántas compras se requieren para emitir el cupón.',
        variant: 'destructive',
      });
      return;
    }
    if (isNaN(days) || days <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'Los días de validez deben ser un número mayor a 0.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({
        loyalty_enabled: enabled,
        loyalty_purchases_required: required,
        loyalty_reward_description: rewardDescription.trim() || null,
        loyalty_coupon_valid_days: days,
      })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Programa de fidelidad actualizado',
      description: enabled
        ? `Se emitirá un cupón cada ${required} compras/servicios.`
        : 'El programa de fidelidad está desactivado.',
    });
  };

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Programa de Fidelidad</CardTitle>
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
        <CardTitle>Programa de Fidelidad</CardTitle>
        <CardDescription>
          Al llegar al número de compras/servicios indicado, el cliente recibe automáticamente
          un cupón con el premio que describas aquí. El cajero lo ve en el POS y aplica el
          descuento a mano según tu descripción.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="loyalty-enabled">Activar programa de fidelidad</Label>
          </div>
          <Switch id="loyalty-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="purchases-required">Compras/servicios requeridos</Label>
            <Input
              id="purchases-required"
              type="number"
              min="1"
              step="1"
              placeholder="Ej: 10"
              value={purchasesRequired}
              onChange={(e) => setPurchasesRequired(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="valid-days">Días de validez del cupón</Label>
            <Input
              id="valid-days"
              type="number"
              min="1"
              step="1"
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="reward-description">Descripción del premio</Label>
          <Textarea
            id="reward-description"
            placeholder='Ej: "10% de descuento en tu próxima compra" o "Cambio de aceite gratis"'
            value={rewardDescription}
            onChange={(e) => setRewardDescription(e.target.value)}
          />
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
