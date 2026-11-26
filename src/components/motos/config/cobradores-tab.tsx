'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useCobranza } from '@/hooks/use-cobranza';
import { supabase } from '@/lib/supabase/client';

type UsuarioDeSucursal = { id: string; name: string; roleName?: string; cobra: boolean; esAdmin: boolean };

// Usuarios de la sucursal activa con un interruptor «Es cobrador», como los
// técnicos del Taller. Cobrar en la calle pide además un rol con «cobrar en la
// calle» (el rol Cobrador lo trae); si no lo tiene, se avisa.
export function CobradoresTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const { branchId, cobradores, marcarCobrador } = useCobranza();
  const [usuarios, setUsuarios] = useState<UsuarioDeSucursal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId) return;
    supabase
      .from('profile_branches')
      .select('profile_id, profiles!inner(id, name, is_active, role), roles(name, permissions)')
      .eq('branch_id', branchId)
      .then(({ data }) => {
        setUsuarios(
          (data ?? [])
            .filter((r: any) => r.profiles?.is_active !== false)
            .map((r: any) => ({
              id: r.profiles.id,
              name: r.profiles.name ?? 'Sin nombre',
              roleName: r.roles?.name,
              cobra: Array.isArray(r.roles?.permissions?.cobranza) && r.roles.permissions.cobranza.includes('create'),
              esAdmin: r.profiles.role === 'admin',
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        );
      });
  }, [branchId]);

  const esCobrador = (id: string) => cobradores.some((c) => c.profileId === id && c.isActive);

  const cambiar = async (u: UsuarioDeSucursal, on: boolean) => {
    setBusy(u.id);
    try {
      await marcarCobrador(u.id, on);
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cobradores de esta sucursal</CardTitle>
        <CardDescription>
          Solo a ellos se les asigna cartera y solo ellos cobran desde la ruta. El efectivo que cobran
          queda a su cargo hasta que lo entregan en el cuadre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {usuarios.length === 0 && <p className="text-sm text-muted-foreground">No hay usuarios en esta sucursal.</p>}
        {usuarios.map((u) => {
          const marcado = esCobrador(u.id);
          return (
            <div key={u.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="font-medium">{u.name}</p>
                {u.roleName && <p className="text-sm text-muted-foreground">{u.roleName}</p>}
                {marcado && !u.cobra && !u.esAdmin && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Su rol no permite cobrar en la calle. Dale el rol Cobrador en Usuarios.
                  </p>
                )}
              </div>
              <Switch
                checked={marcado}
                disabled={!canEdit || busy === u.id}
                onCheckedChange={(v) => cambiar(u, v)}
                aria-label={`${u.name} es cobrador`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
