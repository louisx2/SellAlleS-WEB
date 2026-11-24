'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { useLoans } from '@/context/loan-provider';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { calculateFinancingStatus } from '@/lib/utils';
import { hoyLocal } from '@/lib/subscription-status';
import { cuentaDesdeCuotas, type CuentaDeCobro, type ResultadoVisita } from '@/lib/cobranza';
import {
  rowToAbonoDeCobrador, rowToAsignacion, rowToCobrador, rowToEntrega, rowToLoanPaymentResult,
  rowToPaymentResult, rowToVisita,
} from '@/lib/supabase/mappers';
import type {
  AbonoDeCobrador, AsignacionDeCartera, Cobrador, CobroDeRuta, EntregaDeCobrador, EntregaRecibida, VisitaDeCobro,
} from '@/lib/types';

const DIAS_DE_VISITAS = 30;

export type AbonoDeRuta = {
  tipo: 'prestamo' | 'venta' | 'cliente';
  id: string;
  monto: number;
  metodo: 'cash' | 'transfer';
  referencia?: string;
  nota?: string;
};

export type VisitaNueva = {
  customerId: string;
  outcome: Exclude<ResultadoVisita, 'pago'>;
  promiseDate?: string;
  promiseAmount?: number;
  note?: string;
};

/**
 * Cobradores, cartera, visitas, abonos y entregas de una sucursal (por defecto
 * la activa). La RLS recorta: un cobrador sin `cobranza-all` solo ve su cartera
 * y sus visitas. Cobrar, anotar visitas y recibir entregas van por RPC.
 */
export function useCobranza(branchId?: string) {
  const { appUser } = useAuth();
  const branch = branchId ?? appUser?.activeBranchId ?? '';
  const [cobradores, setCobradores] = useState<Cobrador[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionDeCartera[]>([]);
  const [visitasRecientes, setVisitas] = useState<VisitaDeCobro[]>([]);
  const [abonos, setAbonos] = useState<AbonoDeCobrador[]>([]);
  const [entregas, setEntregas] = useState<EntregaDeCobrador[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branch) { setLoading(false); return; }
    setLoading(true);
    const desdeHoy = new Date(`${hoyLocal()}T00:00:00`).toISOString();
    const desdeVisitas = new Date(Date.now() - DIAS_DE_VISITAS * 86_400_000).toISOString();
    // Lo de hoy (para «cobrado hoy») y todo lo que sigue en la calle.
    const filtroAbonos = `date.gte.${desdeHoy},and(en_calle.eq.true,settlement_id.is.null)`;
    const columnasAbono = 'id, collector_id, customer_id, amount, method, date, en_calle, settlement_id, voided_at';
    const [c, a, v, lp, cp, e] = await Promise.all([
      supabase.from('collectors').select('id, branch_id, profile_id, is_active, profiles(name)').eq('branch_id', branch),
      supabase.from('collection_assignments').select('*').eq('branch_id', branch),
      supabase.from('collection_visits').select('*').eq('branch_id', branch).gte('created_at', desdeVisitas)
        .order('created_at', { ascending: false }).limit(1000),
      supabase.from('loan_payments').select(`${columnasAbono}, loan_id`).eq('branch_id', branch)
        .not('collector_id', 'is', null).or(filtroAbonos),
      supabase.from('credit_payments').select(`${columnasAbono}, sale_id`).eq('branch_id', branch)
        .not('collector_id', 'is', null).or(filtroAbonos),
      supabase.from('collector_settlements').select('*').eq('branch_id', branch)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setCobradores((c.data ?? []).map(rowToCobrador).sort((x, y) => x.name.localeCompare(y.name, 'es')));
    setAsignaciones((a.data ?? []).map(rowToAsignacion));
    setVisitas((v.data ?? []).map(rowToVisita));
    setAbonos([
      ...(lp.data ?? []).map((r) => rowToAbonoDeCobrador('prestamo', r)),
      ...(cp.data ?? []).map((r) => rowToAbonoDeCobrador('venta', r)),
    ].sort((x, y) => y.date.localeCompare(x.date)));
    setEntregas((e.data ?? []).map(rowToEntrega));
    setLoading(false);
  }, [branch]);

  useEffect(() => { reload(); }, [reload]);

  const miCobrador = useMemo(
    () => cobradores.find((c) => c.profileId === appUser?.id && c.isActive),
    [cobradores, appUser?.id],
  );

  const abonosSinEntregar = useMemo(
    () => abonos.filter((x) => x.method === 'cash' && x.enCalle && !x.settlementId && !x.voided),
    [abonos],
  );

  const registrarAbono = async (abono: AbonoDeRuta): Promise<CobroDeRuta> => {
    const { data, error } = await supabase.rpc('cobranza_registrar_abono', {
      p_tipo: abono.tipo, p_id: abono.id, p_branch_id: branch, p_amount: abono.monto, p_method: abono.metodo,
      p_reference: abono.referencia?.trim() || null, p_notes: abono.nota?.trim() || null,
    });
    if (error) throw error;
    await reload();
    if (abono.tipo === 'prestamo') {
      const r = rowToLoanPaymentResult(data);
      return { paymentId: r.paymentId, aplicado: r.principalPaid, mora: r.lateFeePaid, saldo: r.remainingBalance, enCalle: !!(data as any)?.en_calle };
    }
    const r = rowToPaymentResult(data);
    return {
      paymentId: r.paymentId, aplicado: r.principalPaid, mora: r.lateFeePaid,
      saldo: abono.tipo === 'cliente' ? r.customerBalance : r.remainingBalance, enCalle: !!(data as any)?.en_calle,
    };
  };

  const registrarVisita = async (visita: VisitaNueva): Promise<void> => {
    const { error } = await supabase.rpc('cobranza_registrar_visita', {
      p_branch_id: branch, p_customer_id: visita.customerId, p_outcome: visita.outcome,
      p_promise_date: visita.outcome === 'promesa' ? visita.promiseDate ?? null : null,
      p_promise_amount: visita.outcome === 'promesa' ? visita.promiseAmount ?? null : null,
      p_note: visita.note?.trim() || null,
    });
    if (error) throw error;
    await reload();
  };

  const recibirEntrega = async (collectorId: string, recibido: number, nota?: string): Promise<EntregaRecibida> => {
    const { data, error } = await supabase.rpc('cobranza_recibir_entrega', {
      p_collector_id: collectorId, p_received: recibido, p_note: nota?.trim() || null,
    });
    if (error) throw error;
    await reload();
    const r = data as any;
    return {
      settlementId: r.settlement_id, expected: Number(r.expected), received: Number(r.received),
      difference: Number(r.difference), payments: Number(r.payments),
    };
  };

  /** Asigna (o reasigna) clientes a un cobrador; los nuevos van al final de su orden. */
  const asignar = async (customerIds: string[], collectorId: string): Promise<void> => {
    if (customerIds.length === 0) return;
    let siguiente = Math.max(0, ...asignaciones.filter((x) => x.collectorId === collectorId).map((x) => x.orden)) + 1;
    const filas = customerIds.map((customerId) => {
      const previa = asignaciones.find((x) => x.customerId === customerId);
      const orden = previa?.collectorId === collectorId ? previa.orden : siguiente++;
      return { branch_id: branch, customer_id: customerId, collector_id: collectorId, visit_order: orden, updated_at: new Date().toISOString() };
    });
    const { error } = await supabase.from('collection_assignments').upsert(filas, { onConflict: 'branch_id,customer_id' });
    if (error) throw error;
    await reload();
  };

  const quitarAsignacion = async (customerIds: string[]): Promise<void> => {
    if (customerIds.length === 0) return;
    const { error } = await supabase.from('collection_assignments').delete().eq('branch_id', branch).in('customer_id', customerIds);
    if (error) throw error;
    await reload();
  };

  const ordenar = async (customerId: string, orden: number): Promise<void> => {
    const { error } = await supabase.from('collection_assignments')
      .update({ visit_order: Math.max(0, Math.round(orden)), updated_at: new Date().toISOString() })
      .eq('branch_id', branch).eq('customer_id', customerId);
    if (error) throw error;
    await reload();
  };

  /** Marca o desmarca a un usuario como cobrador de la sucursal. Desmarcar no
   *  borra: sus abonos y entregas siguen apuntando a él. */
  const marcarCobrador = async (profileId: string, activo: boolean): Promise<void> => {
    const { error } = activo
      ? await supabase.from('collectors').upsert(
          { branch_id: branch, profile_id: profileId, is_active: true }, { onConflict: 'branch_id,profile_id' })
      : await supabase.from('collectors').update({ is_active: false }).eq('branch_id', branch).eq('profile_id', profileId);
    if (error) throw error;
    await reload();
  };

  return {
    branchId: branch, cobradores, asignaciones, visitasRecientes, abonos, abonosSinEntregar, entregas, miCobrador,
    loading, reload, registrarAbono, registrarVisita, recibirEntrega, asignar, quitarAsignacion, ordenar, marcarCobrador,
  };
}

/** Las cuentas abiertas de la sucursal (préstamos y ventas a crédito o
 *  financiadas), con la mora de la política de siempre, listas para la ruta. */
export function useCuentasDeCobro(branchId?: string): CuentaDeCobro[] {
  const { appUser } = useAuth();
  const branch = branchId ?? appUser?.activeBranchId ?? '';
  const { loans } = useLoans();
  const { sales, financingSales } = useSales();
  const { profile } = useCompanyProfile();

  return useMemo(() => {
    const hoy = hoyLocal();
    const cuentas: CuentaDeCobro[] = [];
    for (const l of loans) {
      if (l.branchId !== branch || !l.customerId || ['paid', 'refinanced', 'cancelled'].includes(l.status)) continue;
      const st = calculateLoanStatus(l, profile.loanLateFeeRate, profile.loanLateFeeGraceDays);
      if (st.pendingBalance <= 0.005) continue;
      cuentas.push(cuentaDesdeCuotas({
        tipo: 'prestamo', id: l.id, customerId: l.customerId, branchId: l.branchId,
        pendiente: st.pendingBalance, mora: st.lateFee, cuotas: l.installments ?? [],
      }, hoy));
    }
    const financiadas = new Set(financingSales.map((s) => s.id));
    for (const s of financingSales) {
      if (s.cancelledAt || s.branchId !== branch || !s.customerId) continue;
      const st = calculateFinancingStatus(s, profile.lateFeeRate, profile.lateFeeGraceDays);
      if (st.pendingBalance <= 0.005) continue;
      cuentas.push(cuentaDesdeCuotas({
        tipo: 'venta', id: s.id, customerId: s.customerId, branchId: s.branchId ?? branch,
        pendiente: st.pendingBalance, mora: st.lateFee, cuotas: s.installments ?? [],
      }, hoy));
    }
    for (const s of sales) {
      if (s.cancelledAt || financiadas.has(s.id) || s.paymentMethod !== 'credit' || s.branchId !== branch || !s.customerId) continue;
      const pendiente = Math.round((s.total - s.amountPaid) * 100) / 100;
      if (pendiente <= 0.005) continue;
      cuentas.push(cuentaDesdeCuotas({
        tipo: 'venta', id: s.id, customerId: s.customerId, branchId: s.branchId ?? branch, pendiente, mora: 0, cuotas: [],
      }, hoy));
    }
    return cuentas;
  }, [loans, sales, financingSales, branch, profile.lateFeeRate, profile.lateFeeGraceDays, profile.loanLateFeeRate, profile.loanLateFeeGraceDays]);
}

