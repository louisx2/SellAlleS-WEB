'use client';

import { forwardRef } from 'react';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { vehicleLabel } from '@/lib/motos';
import type { Vehicle } from '@/lib/types';

export type DatosEntrega = {
  recibe: string;
  cedula?: string;
  fecha: Date;
  entregadoPor?: string;
};

/** Los datos de la entrega que ya quedaron guardados en el vehículo. */
export const entregaGuardada = (v: Vehicle): DatosEntrega | null =>
  v.registrationDeliveredTo && v.registrationDeliveredAt
    ? { recibe: v.registrationDeliveredTo, cedula: v.registrationDeliveredDoc, fecha: v.registrationDeliveredAt, entregadoPor: v.registrationDeliveredByName }
    : null;

// Constancia de entrega de la matrícula, para imprimir en carta y firmar.
export const ConstanciaEntrega = forwardRef<HTMLDivElement, { vehicle: Vehicle; datos: DatosEntrega }>(
  function ConstanciaEntrega({ vehicle: v, datos }, ref) {
    const { profile } = useCompanyProfile();
    const fila = (label: string, valor?: string | null) => (
      <tr>
        <td className="py-1 pr-4 text-muted-foreground print:text-black">{label}</td>
        <td className="py-1 font-medium">{valor || '—'}</td>
      </tr>
    );
    return (
      <div ref={ref} className="space-y-5 bg-background p-6 text-sm text-foreground print:p-10 print:text-black">
        <div className="text-center">
          <p className="text-lg font-semibold">{profile.name}</p>
          <p className="text-xs">
            {[profile.address, profile.rnc ? `RNC ${profile.rnc}` : '', profile.phone ? `Tel. ${profile.phone}` : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <h2 className="text-center text-base font-bold uppercase tracking-wide">Constancia de entrega de matrícula</h2>
        <p>
          Hacemos constar que en fecha {datos.fecha.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })} se
          entregó la matrícula del vehículo descrito abajo a <strong>{datos.recibe}</strong>
          {datos.cedula ? <>, cédula <strong>{datos.cedula}</strong></> : null}.
        </p>
        <table className="w-full">
          <tbody>
            {fila('Vehículo', vehicleLabel(v))}
            {fila('Chasis', v.chassis)}
            {fila('Motor', v.engineNumber)}
            {fila('Placa', v.plate)}
            {fila('Número de matrícula', v.registrationNumber)}
            {fila('Cliente', v.customerName)}
            {fila('Entregada por', datos.entregadoPor)}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-10 pt-14 text-center text-xs">
          <div className="border-t pt-1 print:border-black">Entregado por</div>
          <div className="border-t pt-1 print:border-black">Recibido por (nombre y cédula)</div>
        </div>
      </div>
    );
  },
);
