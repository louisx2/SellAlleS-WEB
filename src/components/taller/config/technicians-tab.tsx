'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { TallerConfig } from '../use-taller-config';

type BranchUser = { id: string; name: string; roleName?: string };

export function TechniciansTab({ config, canEdit }: { config: TallerConfig; canEdit: boolean }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<BranchUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

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

  const isTech = (id: string) => config.technicians.some((t) => t.profileId === id);

  const toggle = async (user: BranchUser, on: boolean) => {
    if (!config.branchId) return;
    setBusy(user.id);
    const { error } = on
      ? await supabase.from('service_technicians').insert({ branch_id: config.branchId, profile_id: user.id })
      : await supabase.from('service_technicians').delete().eq('branch_id', config.branchId).eq('profile_id', user.id);
    setBusy(null);
    if (error) { toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' }); return; }
    config.reload();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Técnicos de esta sucursal</CardTitle>
        <CardDescription>
          Solo a ellos se les puede asignar un caso. Para que un técnico vea únicamente sus casos (y
          los sin asignar), dale un rol sin «Taller: ver todos los casos» en Roles.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay usuarios en esta sucursal.</p>
        )}
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium">{u.name}</p>
              {u.roleName && <p className="text-sm text-muted-foreground">{u.roleName}</p>}
            </div>
            <Switch
              checked={isTech(u.id)}
              disabled={!canEdit || busy === u.id}
              onCheckedChange={(v) => toggle(u, v)}
              aria-label={`${u.name} es técnico`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
