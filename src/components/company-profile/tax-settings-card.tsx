'use client';

import { useState } from 'react';
import { Building2, Loader2, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useBranches } from '@/context/branch-provider';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Define si el precio público de la sucursal activa ya incluye ITBIS. El valor se
 * guarda en la sucursal para que una empresa pueda usar esquemas distintos por
 * punto de venta; cada venta congela el modo utilizado para su historial.
 * Admite configurar otras sucursales a través de un diálogo para administradores.
 */
export function TaxSettingsCard() {
  const { branches, updateBranch, loading } = useBranches();
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);

  const activeBranch = branches.find((item) => item.id === appUser?.activeBranchId);

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
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1.5 pr-4">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> Impuestos de la sucursal actual
          </CardTitle>
          <CardDescription>
            Define cómo se muestran los precios al cliente en la sucursal activa. Esta configuración no altera ventas ya realizadas.
          </CardDescription>
        </div>

        {branches.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0" title="Configurar todas las sucursales">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Impuestos por Sucursal</DialogTitle>
                <DialogDescription>
                  Activa o desactiva los precios con ITBIS incluido para cualquiera de las sucursales.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-1">
                {branches.map((branch) => {
                  const saving = savingId === branch.id;
                  return (
                    <div key={branch.id} className="flex items-center justify-between gap-4 border rounded-lg p-3">
                      <div>
                        <p className="font-medium text-sm">{branch.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {branch.itbisIncluded
                            ? 'El precio incluye el ITBIS y el recibo lo desglosa.'
                            : 'El ITBIS se agrega encima del precio.'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        <Switch
                          checked={branch.itbisIncluded ?? false}
                          disabled={saving}
                          onCheckedChange={(value) => setItbisMode(branch.id, value)}
                          aria-label={`Precio con ITBIS incluido para ${branch.name}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
          </div>
        ) : !activeBranch ? (
          <p className="text-sm text-muted-foreground">No hay una sucursal activa seleccionada.</p>
        ) : (
          (() => {
            const branch = activeBranch;
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
          })()
        )}
      </CardContent>
    </Card>
  );
}

