'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchVehiculosDelPrestamo } from '@/hooks/use-vehiculos';
import { useModules } from '@/context/modules-provider';
import { vehicleLabel } from '@/lib/motos';
import { RegistrationText, VehicleStatusBadge } from '@/components/motos/vehicle-status-badge';
import { ContratoBoton } from '@/components/motos/contrato-boton';
import type { Vehicle } from '@/lib/types';

/** Las motos que respaldan el préstamo. No sale si no hay ninguna. */
export function GarantiaCard({ loanId }: { loanId: string }) {
  const { isModuleEnabled } = useModules();
  const activo = isModuleEnabled('motoprestamos');
  const [motos, setMotos] = useState<Vehicle[]>([]);

  useEffect(() => {
    if (!activo || !loanId) return;
    fetchVehiculosDelPrestamo(loanId).then(setMotos).catch(() => setMotos([]));
  }, [activo, loanId]);

  if (motos.length === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Garantía</CardTitle>
        <ContratoBoton tipo="prestamo" id={loanId} size="sm" />
      </CardHeader>
      <CardContent className="space-y-3">
        {motos.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div className="min-w-0">
              <Link href={`/motos/ficha?id=${v.id}`} className="font-medium hover:underline">{vehicleLabel(v)}</Link>
              <p className="text-xs text-muted-foreground">
                Chasis {v.chassis ?? '—'}{v.plate ? ` · Placa ${v.plate}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <VehicleStatusBadge status={v.status} />
              <span className="text-xs">Matrícula: <RegistrationText status={v.registrationStatus} /></span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
