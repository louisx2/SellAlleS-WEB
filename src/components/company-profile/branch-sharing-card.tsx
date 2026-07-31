'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import { useBranches } from '@/context/branch-provider';
import { useSharing, type SharingScope } from '@/context/sharing-provider';
import { supabase } from '@/lib/supabase/client';

const SCOPES: { key: SharingScope; label: string; description: string }[] = [
  {
    key: 'clientes',
    label: 'Clientes',
    description: 'Las sucursales marcadas ven la misma lista de clientes.',
  },
  {
    key: 'credito',
    label: 'Cuentas por cobrar',
    description: 'Las ventas a crédito se pueden ver y cobrar desde las sucursales marcadas.',
  },
  {
    key: 'financiamiento',
    label: 'Financiamientos',
    description: 'Los financiamientos se pueden ver y pagar desde las sucursales marcadas.',
  },
  {
    key: 'prestamos',
    label: 'Préstamos',
    description: 'Los préstamos de dinero se pueden ver y cobrar desde las sucursales marcadas.',
  },
  {
    key: 'servicios',
    label: 'Servicios y reparaciones',
    description: 'Las órdenes de servicio se ven desde las sucursales marcadas.',
  },
];

// Compartir entre sucursales: por cada ámbito se marca qué sucursales entran al
// grupo. Las marcadas se ven entre sí; una sucursal sin marcar solo ve lo suyo.
// Editable por el admin de la empresa (y por el super admin impersonando).
export function BranchSharingCard() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const { branches } = useBranches();
  const { pool, loading, reload } = useSharing();
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [saving, setSaving] = useState<string | null>(null);

  const toggle = async (scope: SharingScope, branchId: string, marcada: boolean) => {
    if (!activeCompanyId) return;
    const key = `${scope}:${branchId}`;
    setSaving(key);
    const { error } = marcada
      ? await supabase.from('branch_sharing').insert({ company_id: activeCompanyId, scope, branch_id: branchId })
      : await supabase.from('branch_sharing').delete()
          .eq('company_id', activeCompanyId).eq('scope', scope).eq('branch_id', branchId);
    setSaving(null);
    if (error) {
      toast({ title: 'No se pudo guardar', description: error.message, variant: 'destructive' });
      return;
    }
    await reload();
  };

  // Solo administradores gestionan esta config.
  if (appUser?.role !== 'admin') return null;

  const activas = branches.filter((b) => b.isActive);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compartir entre Sucursales</CardTitle>
        <CardDescription>
          Marca qué sucursales comparten cada tipo de información. Las marcadas se ven entre sí;
          una sucursal sin marcar solo ve lo suyo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : activas.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Con una sola sucursal no hay nada que compartir. Esta configuración aparece cuando
            la empresa tenga dos o más.
          </p>
        ) : (
          SCOPES.map((s) => {
            const marcadas = pool(s.key);
            return (
              <div key={s.key} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground mb-3">{s.description}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {activas.map((b) => {
                    const id = `${s.key}-${b.id}`;
                    const key = `${s.key}:${b.id}`;
                    return (
                      <div key={b.id} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={marcadas.includes(b.id)}
                          disabled={saving === key}
                          onCheckedChange={(v) => toggle(s.key, b.id, v === true)}
                        />
                        <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
                          {b.name}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
