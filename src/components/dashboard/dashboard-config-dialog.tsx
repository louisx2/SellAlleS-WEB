'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ChartType } from '@/components/dashboard/flex-chart';
import {
  DASHBOARD_WIDGETS, type DashboardConfig, type WidgetId,
} from '@/lib/dashboard-config';

const CHART_LABEL: Record<ChartType, string> = {
  bar: 'Barras', line: 'Línea', pie: 'Círculo', table: 'Tabla',
};

interface DashboardConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DashboardConfig;
  isAdmin: boolean;
  onSave: (config: DashboardConfig) => void;
}

// Panel para elegir qué widgets ver y con qué tipo de gráfico. Trabaja sobre
// una copia local y confirma al guardar.
export function DashboardConfigDialog({ open, onOpenChange, config, isAdmin, onSave }: DashboardConfigDialogProps) {
  const [draft, setDraft] = useState<DashboardConfig>(config);

  useEffect(() => { if (open) setDraft(config); }, [open, config]);

  const widgets = DASHBOARD_WIDGETS.filter((w) => !w.adminOnly || isAdmin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar dashboard</DialogTitle>
          <DialogDescription>Elige qué ver y cómo verlo. Se guarda en este dispositivo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {widgets.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{w.label}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {w.chartTypes && draft.visible[w.id] && (
                  <Select
                    value={draft.charts[w.id] ?? w.defaultChart ?? 'bar'}
                    onValueChange={(v) => setDraft((d) => ({ ...d, charts: { ...d.charts, [w.id]: v as ChartType } }))}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {w.chartTypes.map((t) => <SelectItem key={t} value={t}>{CHART_LABEL[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Switch
                  checked={draft.visible[w.id]}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, visible: { ...d.visible, [w.id as WidgetId]: v } }))}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { onSave(draft); onOpenChange(false); }}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
