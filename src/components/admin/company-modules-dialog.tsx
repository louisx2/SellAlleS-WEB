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
import { RUBROS } from '@/lib/taller';
import { aplicarPlantilla } from '@/components/taller/aplicar-plantilla';
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
  // La facturación electrónica es solo para empresas formalizadas. Se lee aquí
  // y no del listado: el listado puede traer la empresa como estaba al cargar.
  const [formalizada, setFormalizada] = useState(false);
  // Al encender Servicios se ofrece cargar una plantilla de fichas y chequeos.
  const [eligiendoPlantilla, setEligiendoPlantilla] = useState(false);
  const [plantilla, setPlantilla] = useState('');
  const [aplicando, setAplicando] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [{ data }, { data: empresa }] = await Promise.all([
      supabase.from('company_modules').select('module_key, enabled').eq('company_id', companyId),
      supabase.from('companies').select('is_formalized').eq('id', companyId).maybeSingle(),
    ]);
    setFormalizada(!!empresa?.is_formalized);
    const overrides = new Map((data ?? []).map((r) => [r.module_key, r.enabled]));
    const next: Record<string, boolean> = {};
    for (const mod of APP_MODULES) {
      next[mod.key] = (overrides.get(mod.key) as boolean | undefined) ?? mod.defaultEnabled;
    }
    setState(next);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open) { setEligiendoPlantilla(false); setPlantilla(''); } }, [open]);

  const cargarPlantilla = async () => {
    if (!companyId) return;
    if (!plantilla) { setEligiendoPlantilla(false); return; }
    setAplicando(true);
    // Los nombres que la empresa ya tiene, para no duplicar fichas.
    const { data: tipos } = await supabase.from('service_equipment_types').select('name').eq('company_id', companyId);
    const { creados, error } = await aplicarPlantilla(plantilla, {
      companyId, existentes: (tipos ?? []).map((t: { name: string }) => t.name),
    });
    setAplicando(false);
    if (error) {
      toast({ title: 'No se pudo cargar la plantilla', description: error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Plantilla cargada', description: creados.length ? creados.join(', ') : 'La empresa ya tenía esas fichas.' });
    setEligiendoPlantilla(false);
    setPlantilla('');
  };

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

    // Motopréstamos vive sobre Préstamos: encenderlo enciende Préstamos, y si la
    // empresa no usa Caja se le avisa (el dinero prestado no quedaría controlado).
    if (key === 'motoprestamos' && value) {
      if (!state.prestamos) {
        const { error: loanError } = await supabase
          .from('company_modules')
          .upsert({ company_id: companyId, module_key: 'prestamos', enabled: true }, { onConflict: 'company_id,module_key' });
        if (loanError) {
          setSavingKey(null);
          toast({ title: 'Motopréstamos encendido, pero no Préstamos', description: loanError.message, variant: 'destructive' });
          return;
        }
      }
      if (!state.caja) {
        toast({ title: 'Recomendado: encender Caja', description: 'Así el efectivo de los préstamos y los cobros queda controlado.' });
      }
    }

    setSavingKey(null);
    if (key === 'services' && value) setEligiendoPlantilla(true);
    setState((prev) => ({ ...prev, [key]: value, ...(key === 'motoprestamos' && value ? { prestamos: true } : {}) }));
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

        {eligiendoPlantilla ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">¿Con qué plantilla empieza Servicios?</p>
              <p className="text-xs text-muted-foreground">
                Carga las fichas y los chequeos típicos del negocio. Todo se puede editar después.
              </p>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
              {[...RUBROS.map((r) => ({ key: r.key, label: r.label })), { key: '', label: 'Ninguna' }].map((r) => (
                <label key={r.key || 'ninguna'} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                  <input
                    type="radio"
                    name="plantilla-servicios"
                    className="h-4 w-4"
                    checked={plantilla === r.key}
                    onChange={() => setPlantilla(r.key)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={aplicando} onClick={() => setEligiendoPlantilla(false)}>Omitir</Button>
              <Button disabled={aplicando} onClick={cargarPlantilla}>
                {aplicando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {plantilla ? 'Cargar plantilla' : 'Seguir sin plantilla'}
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {APP_MODULES.map((mod) => {
              const encendido = state[mod.key] ?? mod.defaultEnabled;
              // El e-CF no se enciende en una empresa sin formalizar. Si ya estaba
              // encendido sí se deja apagar: deshabilitarlo del todo lo dejaría
              // trabado en una empresa que perdió la formalización.
              const soloFormalizadas = mod.key === 'ecf' && !formalizada;
              return (
                <div key={mod.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="pr-4">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {mod.label}
                      {mod.comingSoon && <Badge variant="secondary" className="text-[10px]">Próximamente</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                    {soloFormalizadas && (
                      <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        Solo para empresas formalizadas.
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={encendido}
                    disabled={savingKey === mod.key || (soloFormalizadas && !encendido)}
                    onCheckedChange={(v) => toggle(mod.key, v)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {!eligiendoPlantilla && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
