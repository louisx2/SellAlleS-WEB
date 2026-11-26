'use client';

// Motopréstamos 4A: recuperaciones de una moto (o de la sucursal activa) y las
// acciones que las crean. Todo pasa por las RPC; la base valida estados,
// permisos y caja, y su mensaje de error se lanza tal cual.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { rowToVehicleRecovery } from '@/lib/supabase/mappers';
import type { VehicleRecovery } from '@/lib/types';

export type IncautarInput = { fecha: string; motivo: string; nota?: string };

export type LiquidarInput = {
  modo: 'tercero' | 'dacion';
  monto: number;
  metodo: 'cash' | 'transfer';
  /** Artículo-vehículo de la sucursal al que entra la moto (solo dación). */
  productId?: string;
  /** Qué hacer con lo que falte: queda como deuda del préstamo o se da de baja. */
  faltante: 'deuda' | 'baja';
  referencia?: string;
  nota?: string;
};

export type ResultadoLiquidacion = {
  recoveryId: string;
  deuda: number;
  aplicado: number;
  sobrante: number;
  faltante: number;
  paymentId?: string;
};

export type RecuperarVentaInput = {
  fecha: string;
  motivo: string;
  /** Cómo está la moto (rayada, sin batería…). */
  estado?: string;
  valorReingreso: number;
  devolucion?: number;
  devolucionMetodo?: 'cash' | 'transfer';
  nota?: string;
};

export type ResultadoRecuperarVenta = { recoveryId: string; deuda: number; devuelto: number };

const limpio = (s?: string) => (s?.trim() ? s.trim() : null);

/** Recuperaciones de la moto dada; sin moto, las de la sucursal activa.
 *  `enabled: false` no lee nada (la ficha, mientras no sabe qué moto es). */
export function useRecuperaciones(vehicleId?: string, opts?: { enabled?: boolean }) {
  const { appUser } = useAuth();
  const branchId = appUser?.activeBranchId;
  const enabled = opts?.enabled ?? true;
  const [recuperaciones, setRecuperaciones] = useState<VehicleRecovery[]>([]);
  const [loading, setLoading] = useState(true);
  // Solo vale la última lectura: si cambia la moto, la respuesta vieja se descarta.
  const ultima = useRef(0);

  const reload = useCallback(async () => {
    const turno = ++ultima.current;
    if (!enabled || (!vehicleId && !branchId)) { setRecuperaciones([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from('vehicle_recoveries').select('*').order('created_at', { ascending: false });
    q = vehicleId ? q.eq('vehicle_id', vehicleId) : q.eq('branch_id', branchId!);
    const { data } = await q;
    if (turno !== ultima.current) return;
    setRecuperaciones((data ?? []).map(rowToVehicleRecovery));
    setLoading(false);
  }, [enabled, vehicleId, branchId]);

  useEffect(() => { reload(); }, [reload]);

  /** Deuda del préstamo con la mora de hoy: lo máximo que acepta un abono. */
  const deudaDelPrestamo = async (loanId: string): Promise<number> => {
    const { data, error } = await supabase.rpc('motos_deuda_prestamo', { p_loan_id: loanId });
    if (error) throw error;
    return Number(data ?? 0);
  };

  const incautar = async (id: string, input: IncautarInput): Promise<string> => {
    const { data, error } = await supabase.rpc('motos_incautar', {
      p_vehicle_id: id,
      p_fecha: input.fecha,
      p_motivo: input.motivo.trim(),
      p_nota: limpio(input.nota),
    });
    if (error) throw error;
    await reload();
    return data as string;
  };

  const devolver = async (id: string, nota?: string): Promise<void> => {
    const { error } = await supabase.rpc('motos_devolver_garantia', { p_vehicle_id: id, p_nota: limpio(nota) });
    if (error) throw error;
    await reload();
  };

  const liquidar = async (id: string, input: LiquidarInput): Promise<ResultadoLiquidacion> => {
    const { data, error } = await supabase.rpc('motos_liquidar_garantia', {
      p_vehicle_id: id,
      p_modo: input.modo,
      p_monto: input.monto,
      p_metodo: input.metodo,
      p_product_id: input.modo === 'dacion' ? input.productId ?? null : null,
      p_faltante: input.faltante,
      p_referencia: limpio(input.referencia),
      p_nota: limpio(input.nota),
    });
    if (error) throw error;
    await reload();
    const r = data as any;
    return {
      recoveryId: r.recovery_id,
      deuda: Number(r.deuda),
      aplicado: Number(r.aplicado),
      sobrante: Number(r.sobrante),
      faltante: Number(r.faltante),
      paymentId: r.payment_id ?? undefined,
    };
  };

  const recuperarVenta = async (id: string, input: RecuperarVentaInput): Promise<ResultadoRecuperarVenta> => {
    const { data, error } = await supabase.rpc('motos_recuperar_venta', {
      p_vehicle_id: id,
      p_fecha: input.fecha,
      p_motivo: input.motivo.trim(),
      p_estado: limpio(input.estado),
      p_valor_reingreso: input.valorReingreso,
      p_devolucion: input.devolucion ?? 0,
      p_devolucion_metodo: input.devolucionMetodo ?? 'cash',
      p_nota: limpio(input.nota),
    });
    if (error) throw error;
    await reload();
    const r = data as any;
    return { recoveryId: r.recovery_id, deuda: Number(r.deuda), devuelto: Number(r.devuelto) };
  };

  return { recuperaciones, loading, reload, deudaDelPrestamo, incautar, devolver, liquidar, recuperarVenta };
}
