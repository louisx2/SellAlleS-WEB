'use client';

import { forwardRef } from 'react';
import { montoRD, type Segmento } from '@/lib/contrato';

export type CuotaDelPlan = { numero: number; fecha: string; monto: number };

// El contrato ya llenado, en carta: texto con sus saltos de línea y la tabla de
// cuotas donde va {plan}. Lo usan la vista previa de Configuración y la página
// del contrato.
export const ContratoDocumento = forwardRef<HTMLDivElement, { segmentos: Segmento[]; plan: CuotaDelPlan[] }>(
  function ContratoDocumento({ segmentos, plan }, ref) {
    return (
      <div ref={ref} className="contrato-motos p-8 text-[13px] leading-relaxed print:p-0">
        {segmentos.map((s, i) => (s.tipo === 'texto' ? (
          <p key={i} className="whitespace-pre-wrap">{s.texto}</p>
        ) : (
          <table key={i} className="my-3 w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="border border-black/40 px-2 py-1 text-left">Cuota</th>
                <th className="border border-black/40 px-2 py-1 text-left">Fecha</th>
                <th className="border border-black/40 px-2 py-1 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {plan.length > 0 ? plan.map((c) => (
                <tr key={c.numero}>
                  <td className="border border-black/40 px-2 py-0.5">{c.numero}</td>
                  <td className="border border-black/40 px-2 py-0.5">{c.fecha}</td>
                  <td className="border border-black/40 px-2 py-0.5 text-right">{montoRD(c.monto)}</td>
                </tr>
              )) : (
                <tr><td colSpan={3} className="border border-black/40 px-2 py-1 text-center">Sin cuotas</td></tr>
              )}
            </tbody>
          </table>
        )))}
      </div>
    );
  },
);
