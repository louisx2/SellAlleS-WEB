'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BranchChecklist } from '@/components/users/branch-checklist';
import { Trash2, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import type { ConsolidatedDashboardConfig } from '@/lib/types';

export interface AvailableCompany {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

export interface ExternalEntry {
  id: string;
  label: string;
  kind: 'income' | 'expense';
  amount: number;
}

interface ConsolidatedDashboardConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  availableCompanies: AvailableCompany[];
  config: ConsolidatedDashboardConfig;
  onConfigSaved: (config: ConsolidatedDashboardConfig) => void;
  externalEntries: ExternalEntry[];
  onExternalEntriesChanged: (entries: ExternalEntry[]) => void;
}

const emptyEntryForm = { label: '', kind: 'income' as 'income' | 'expense', amount: '' };

// Configuración del Panel Consolidado: qué empresas/sucursales suman a los
// totales (borrador + Guardar, mismo patrón que platform-user-dialog.tsx), y
// una lista de ingresos/gastos externos que el usuario mantiene por su cuenta
// (cambios inmediatos, sin borrador).
export function ConsolidatedDashboardConfigDialog({
  open, onOpenChange, profileId, availableCompanies, config, onConfigSaved,
  externalEntries, onExternalEntriesChanged,
}: ConsolidatedDashboardConfigDialogProps) {
  const { toast } = useToast();
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [branchesByCompany, setBranchesByCompany] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [addingEntry, setAddingEntry] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedCompanyIds(config.companyIds ?? []);
    setBranchesByCompany(config.branchesByCompany ?? {});
  }, [open, config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextConfig: ConsolidatedDashboardConfig = {
        companyIds: selectedCompanyIds,
        branchesByCompany,
      };
      const { error } = await supabase
        .from('profiles')
        .update({ consolidated_dashboard_config: nextConfig })
        .eq('id', profileId);
      if (error) throw error;
      onConfigSaved(nextConfig);
      toast({ title: 'Configuración guardada' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo guardar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddEntry = async () => {
    const amount = parseFloat(entryForm.amount);
    if (!entryForm.label.trim() || isNaN(amount) || amount < 0) {
      toast({ title: 'Datos incompletos', description: 'Escribe una etiqueta y un monto válido.', variant: 'destructive' });
      return;
    }
    setAddingEntry(true);
    try {
      const { data, error } = await supabase
        .from('dashboard_external_entries')
        .insert({ profile_id: profileId, label: entryForm.label.trim(), kind: entryForm.kind, amount })
        .select()
        .single();
      if (error) throw error;
      onExternalEntriesChanged([...externalEntries, { id: data.id, label: data.label, kind: data.kind, amount: Number(data.amount) }]);
      setEntryForm(emptyEntryForm);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo agregar.', variant: 'destructive' });
    } finally {
      setAddingEntry(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    const { error } = await supabase.from('dashboard_external_entries').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    onExternalEntriesChanged(externalEntries.filter((e) => e.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Panel Consolidado</DialogTitle>
          <DialogDescription>Elige qué empresas y sucursales suman a los totales, y agrega otros negocios o gastos fuera del sistema.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Empresas</Label>
            <div className="border rounded-md p-3 max-h-[140px] overflow-y-auto space-y-2">
              {availableCompanies.map((c) => (
                <div key={c.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`consolidated-company-${c.id}`}
                    checked={selectedCompanyIds.includes(c.id)}
                    onCheckedChange={(checked) => {
                      setSelectedCompanyIds((prev) =>
                        checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                      );
                    }}
                  />
                  <Label htmlFor={`consolidated-company-${c.id}`} className="font-normal cursor-pointer text-sm">
                    {c.name}
                  </Label>
                </div>
              ))}
              {availableCompanies.length === 0 && (
                <p className="text-sm text-muted-foreground">No administras ninguna empresa todavía.</p>
              )}
            </div>
          </div>

          {selectedCompanyIds.map((compId) => {
            const company = availableCompanies.find((c) => c.id === compId);
            if (!company) return null;
            return (
              <div key={compId} className="grid gap-2">
                <Label>Sucursales — {company.name}</Label>
                <BranchChecklist
                  branches={company.branches}
                  selectedIds={branchesByCompany[compId] ?? []}
                  onChange={(ids) => setBranchesByCompany((prev) => ({ ...prev, [compId]: ids }))}
                  idPrefix={`consolidated-branch-${compId}`}
                />
              </div>
            );
          })}

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar empresas y sucursales'}
            </Button>
          </div>

          <div className="grid gap-2 pt-2 border-t">
            <Label>Otros ingresos/gastos (fuera del sistema)</Label>
            <div className="space-y-2">
              {externalEntries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.label}</p>
                    <p className={`text-xs ${e.kind === 'income' ? 'text-emerald-600' : 'text-destructive'}`}>
                      {e.kind === 'income' ? '+ ' : '- '}{formatCurrency(e.amount)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDeleteEntry(e.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {externalEntries.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin entradas manuales todavía.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Input
                placeholder="Etiqueta (ej. Otro negocio)"
                value={entryForm.label}
                onChange={(e) => setEntryForm((f) => ({ ...f, label: e.target.value }))}
                className="flex-1"
              />
              <Select value={entryForm.kind} onValueChange={(v) => setEntryForm((f) => ({ ...f, kind: v as 'income' | 'expense' }))}>
                <SelectTrigger className="w-full sm:w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Ingreso</SelectItem>
                  <SelectItem value="expense">Gasto</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Monto"
                value={entryForm.amount}
                onChange={(e) => setEntryForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full sm:w-[110px]"
              />
              <Button size="sm" onClick={handleAddEntry} disabled={addingEntry} className="shrink-0">
                <PlusCircle className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Agregar</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
