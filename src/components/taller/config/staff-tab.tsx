'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Pencil, Plus, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { Staff } from '@/lib/types';
import type { TallerConfig } from '../use-taller-config';

type BranchUser = { id: string; name: string; roleName?: string };

type Draft = {
  id?: string;
  name: string;
  phone: string;
  color: string;
  commission: string;
  profileId: string;
  isActive: boolean;
};

const SIN_USUARIO = 'none';
const COLOR_BASE = '#6366f1';

// Los diálogos de esta pantalla no usan el Select de Radix (se congela): <select> nativo.
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function StaffTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<BranchUser[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config.branchId) return;
    supabase
      .from('profile_branches')
      .select('profile_id, profiles!inner(id, name, is_active), roles(name)')
      .eq('branch_id', config.branchId)
      .then(({ data }) => {
        setUsers(
          (data ?? [])
            .filter((r: any) => r.profiles?.is_active !== false)
            .map((r: any) => ({ id: r.profiles.id, name: r.profiles.name ?? 'Sin nombre', roleName: r.roles?.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
  }, [config.branchId]);

  const userName = (id?: string) => users.find((u) => u.id === id)?.name;

  const open = (p?: Staff) => setDraft({
    id: p?.id,
    name: p?.name ?? '',
    phone: p?.phone ?? '',
    color: p?.color ?? COLOR_BASE,
    commission: p ? String(p.commissionRate) : '0',
    profileId: p?.profileId ?? SIN_USUARIO,
    isActive: p?.isActive ?? true,
  });

  const save = async () => {
    if (!draft || !config.branchId) return;
    if (!draft.name.trim()) { toast({ title: 'Escribe el nombre', variant: 'destructive' }); return; }
    const rate = draft.commission.trim() === '' ? 0 : Number(draft.commission);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast({ title: 'La comisión va de 0 a 100 %', variant: 'destructive' }); return;
    }
    const row = {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      color: draft.color,
      commission_rate: rate,
      profile_id: draft.profileId === SIN_USUARIO ? null : draft.profileId,
      is_active: draft.isActive,
    };
    setSaving(true);
    const { error } = draft.id
      ? await supabase.from('service_staff').update(row).eq('id', draft.id)
      : await supabase.from('service_staff').insert({ ...row, branch_id: config.branchId, position: config.staff.length });
    setSaving(false);
    if (error) {
      const dup = error.message.includes('service_staff_branch_profile_uq');
      toast({
        title: 'No se pudo guardar',
        description: dup ? 'Ese usuario ya está ligado a otra persona de esta sucursal.' : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: draft.id ? 'Persona actualizada' : 'Persona agregada' });
    setDraft(null);
    config.reload();
  };

  const toggleActive = async (p: Staff) => {
    const { error } = await supabase.from('service_staff').update({ is_active: !p.isActive }).eq('id', p.id);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    config.reload();
  };

  // A quien ya atendió órdenes no se le borra: se desactiva. Sin órdenes, se borra.
  const remove = async (p: Staff) => {
    const [a, b] = await Promise.all([
      supabase.from('services').select('id', { count: 'exact', head: true }).eq('staff_id', p.id),
      supabase.from('service_item_staff').select('staff_id', { count: 'exact', head: true }).eq('staff_id', p.id),
    ]);
    if (a.error || b.error) {
      toast({ title: 'No se pudo revisar', description: (a.error ?? b.error)?.message, variant: 'destructive' }); return;
    }
    if ((a.count ?? 0) > 0 || (b.count ?? 0) > 0) {
      toast({ title: `${p.name} tiene órdenes`, description: 'No se borra: desactívala y deja de salir en la lista.' });
      return;
    }
    if (!confirm(`¿Borrar a ${p.name}?`)) return;
    const { error } = await supabase.from('service_staff').delete().eq('id', p.id);
    if (error) { toast({ title: 'No se pudo borrar', description: error.message, variant: 'destructive' }); return; }
    config.reload();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Personal de esta sucursal</CardTitle>
          <CardDescription>
            Quien atiende las órdenes: barberos, estilistas, mecánicos… Quien no tiene usuario no
            gasta cupo. Con usuario, entra y ve lo suyo.
          </CardDescription>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" />Agregar persona</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {config.staff.length === 0 && (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía no hay personal en esta sucursal.
          </p>
        )}
        {config.staff.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: p.color ?? COLOR_BASE }} aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {!p.isActive && <Badge variant="outline">Inactiva</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {p.phone ? `${p.phone} · ` : ''}comisión {p.commissionRate}%
                  {p.profileId ? ` · usuario: ${userName(p.profileId) ?? 'de otra sucursal'}` : ''}
                </p>
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                <Switch checked={p.isActive} onCheckedChange={() => toggleActive(p)} aria-label={`${p.name} activa`} />
                <Button variant="ghost" size="icon" aria-label={`Editar ${p.name}`} onClick={() => open(p)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Borrar ${p.name}`} className="text-destructive" onClick={() => remove(p)}><Trash className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar persona' : 'Agregar persona'}</DialogTitle>
            <DialogDescription>Quien atiende las órdenes. El usuario es opcional.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="st-name">Nombre</Label>
                <Input id="st-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="st-phone">Teléfono</Label>
                  <Input id="st-phone" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-comm">Comisión (%)</Label>
                  <Input id="st-comm" inputMode="decimal" value={draft.commission} onChange={(e) => setDraft({ ...draft, commission: e.target.value.replace(/[^\d.]/g, '') })} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="st-color">Color</Label>
                  <input
                    id="st-color" type="color" value={draft.color}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="h-10 w-full cursor-pointer rounded-md border border-input bg-background p-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-user">Usuario (opcional)</Label>
                  <select id="st-user" className={SELECT_CLASS} value={draft.profileId} onChange={(e) => setDraft({ ...draft, profileId: e.target.value })}>
                    <option value={SIN_USUARIO}>Sin usuario</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}{u.roleName ? ` · ${u.roleName}` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Quien no tiene usuario no gasta cupo. Con usuario, entra y ve lo suyo.
              </p>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="st-active">Activa</Label>
                <Switch id="st-active" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
