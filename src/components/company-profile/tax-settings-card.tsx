'use client';

import { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useBranches } from '@/context/branch-provider';
import { useToast } from '@/hooks/use-toast';

/**
 * Define si el precio público de cada sucursal ya incluye ITBIS. El valor se
 * guarda en la sucursal para que una empresa pueda usar esquemas distintos por
 * punto de venta; cada venta congela el modo utilizado para su historial.
 */
export function TaxSettingsCard() {
  const { branches, updateBranch, loading } = useBranches();
  const { toast } = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);

  const setItbisMode = async (branchId: string, itbisIncluded: boolean) => {
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) return;

    setSavingId(branchId);
    try {
      await updateBranch({ ...branch, itbisIncluded });
      toast({
        title: 'Configuración de ITBIS actualizada',
        description: itbisIncluded
          ? `${branch.name}: el precio ya incluye ITBIS.`
          : `${branch.name}: el ITBIS se suma al precio.`,
      });
    } catch (error: any) {
      toast({
        title: 'No se pudo actualizar la configuración',
        description: error?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Impuestos por sucursal
        </CardTitle>
        <CardDescription>
          Define cómo se muestran los precios al cliente. Esta configuración no altera ventas ya realizadas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando sucursales...
          </div>
        ) : branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay sucursales configuradas.</p>
        ) : (
          branches.map((branch) => {
            const saving = savingId === branch.id;
            return (
              <div key={branch.id} className="flex items-center justify-between gap-4 border rounded-lg p-4">
                <div>
                  <p className="font-medium">{branch.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {branch.itbisIncluded
                      ? 'El precio incluye el ITBIS y el recibo lo desglosa.'
                      : 'El ITBIS se agrega encima del precio del producto.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={branch.itbisIncluded ?? false}
                    disabled={saving}
                    onCheckedChange={(value) => setItbisMode(branch.id, value)}
                    aria-label={`Precio con ITBIS incluido para ${branch.name}`}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
