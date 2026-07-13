'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';

type SharingScope = 'clientes' | 'credito' | 'financiamiento' | 'prestamos';

const SCOPES: { key: SharingScope; label: string; description: string }[] = [
  {
    key: 'clientes',
    label: 'Clientes compartidos entre sucursales',
    description: 'Todas las sucursales ven la misma lista de clientes. Apagado: cada sucursal tiene la suya.',
  },
  {
    key: 'credito',
    label: 'Crédito compartido entre sucursales',
    description: 'Las ventas a crédito se pueden ver y cobrar desde cualquier sucursal.',
  },
  {
    key: 'financiamiento',
    label: 'Financiamiento compartido entre sucursales',
    description: 'Los financiamientos se pueden ver y pagar desde cualquier sucursal.',
  },
  {
    key: 'prestamos',
    label: 'Préstamos compartidos entre sucursales',
    description: 'Los préstamos de dinero se pueden ver y cobrar desde cualquier sucursal.',
  },
];

// Config de compartir entre sucursales, editable por el admin de la empresa
// (y por el super admin impersonando). Guarda al alternar cada switch.
export function BranchSharingCard() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;

  const [state, setState] = useState<Record<SharingScope, boolean>>({ clientes: false, credito: false, financiamiento: false, prestamos: false });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<SharingScope | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setLoading(false); return; }
    const { data } = await supabase
      .from('company_branch_sharing')
      .select('scope, enabled')
      .eq('company_id', activeCompanyId);
    const map = new Map((data ?? []).map((r) => [r.scope, r.enabled]));
    setState({
      clientes: (map.get('clientes') as boolean | undefined) ?? false,
      credito: (map.get('credito') as boolean | undefined) ?? false,
      financiamiento: (map.get('financiamiento') as boolean | undefined) ?? false,
      prestamos: (map.get('prestamos') as boolean | undefined) ?? false,
    });
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: SharingScope, value: boolean) => {
    if (!activeCompanyId) return;
    setSavingKey(key);
    const { error } = await supabase
      .from('company_branch_sharing')
      .upsert({ company_id: activeCompanyId, scope: key, enabled: value }, { onConflict: 'company_id,scope' });
    setSavingKey(null);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    setState((prev) => ({ ...prev, [key]: value }));
    toast({
      title: value ? 'Compartir activado' : 'Compartir desactivado',
      description: SCOPES.find((s) => s.key === key)?.label,
    });
  };

  // Solo administradores gestionan esta config.
  if (appUser?.role !== 'admin') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compartir entre Sucursales</CardTitle>
        <CardDescription>
          Elige qué información se comparte entre tus sucursales. Con el interruptor apagado,
          cada sucursal solo ve lo suyo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          SCOPES.map((s) => (
            <div key={s.key} className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-4">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
              <Switch
                checked={state[s.key]}
                disabled={savingKey === s.key}
                onCheckedChange={(v) => toggle(s.key, v)}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
