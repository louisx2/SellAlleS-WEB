'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { APP_MODULES, type ModuleKey } from '@/lib/modules';
import { useModules } from '@/context/modules-provider';
import { Loader2 } from 'lucide-react';

interface CompanyModulesDialogProps {
  companyId: string | null;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Panel del super admin: enciende/apaga módulos para UNA empresa.
// Guarda solo las diferencias contra el default del catálogo (upsert).
export function CompanyModulesDialog({ companyId, companyName, open, onOpenChange }: CompanyModulesDialogProps) {
  const { toast } = useToast();
  const { reload: reloadOwnModules } = useModules();
  const [state, setState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<ModuleKey | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('company_modules')
      .select('module_key, enabled')
      .eq('company_id', companyId);
    const overrides = new Map((data ?? []).map((r) => [r.module_key, r.enabled]));
    const next: Record<string, boolean> = {};
    for (const mod of APP_MODULES) {
      next[mod.key] = (overrides.get(mod.key) as boolean | undefined) ?? mod.defaultEnabled;
    }
    setState(next);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggle = async (key: ModuleKey, value: boolean) => {
    if (!companyId) return;
    setSavingKey(key);
    const { error } = await supabase
      .from('company_modules')
      .upsert({ company_id: companyId, module_key: key, enabled: value }, { onConflict: 'company_id,module_key' });
    if (error) {
      setSavingKey(null);
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }

    // Caja tiene un segundo interruptor por sucursal (branches.caja_enabled).
    // Al apagar el módulo hay que bajar también esas banderas: si no, quedan
    // encendidas y escondidas (el switch de "Editar sucursal" solo se ve con el
    // módulo activo), y al reencender el módulo meses después las sucursales
    // empiezan a exigir caja de golpe sin que nadie lo haya pedido.
    if (key === 'caja' && !value) {
      const { error: branchError } = await supabase
        .from('branches')
        .update({ caja_enabled: false })
        .eq('company_id', companyId)
        .eq('caja_enabled', true);
      if (branchError) {
        setSavingKey(null);
        toast({ title: 'Módulo apagado, pero quedaron sucursales', description: branchError.message, variant: 'destructive' });
        return;
      }
    }

    setSavingKey(null);
    setState((prev) => ({ ...prev, [key]: value }));
    // Si la empresa editada es la del propio super admin, refrescar su menú.
    reloadOwnModules();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Módulos — {companyName}</DialogTitle>
          <DialogDescription>
            Controla qué módulos ve esta empresa. Los cambios aplican de inmediato
            (los usuarios los verán al recargar la página).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {APP_MODULES.map((mod) => (
              <div key={mod.key} className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-4">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {mod.label}
                    {mod.comingSoon && <Badge variant="secondary" className="text-[10px]">Próximamente</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{mod.description}</p>
                </div>
                <Switch
                  checked={state[mod.key] ?? mod.defaultEnabled}
                  disabled={savingKey === mod.key}
                  onCheckedChange={(v) => toggle(mod.key, v)}
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
