'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { calculateFinancingStatus } from '@/lib/utils';
import { hoyLocal } from '@/lib/subscription-status';
import { cuentaDesdeCuotas, type CuentaDeCobro, type ResultadoVisita } from '@/lib/cobranza';
import {
  rowToAbonoDeCobrador, rowToAsignacion, rowToCobrador, rowToEntrega, rowToLoan, rowToLoanPaymentResult,
  rowToPaymentResult, rowToSale, rowToVisita,
} from '@/lib/supabase/mappers';
import type {
  AbonoDeCobrador, AsignacionDeCartera, Cobrador, CobroDeRuta, EntregaDeCobrador, EntregaRecibida, VisitaDeCobro,
} from '@/lib/types';

export type AbonoDeRuta = {
  tipo: 'prestamo' | 'venta' | 'cliente';
  id: string;
  monto: number;
  metodo: 'cash' | 'transfer';
  referencia?: string;
  nota?: string;
  /** Lo genera el diálogo al abrirse: repetir el envío (sin señal) no cobra dos veces. */
  requestId?: string;
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
  const [promesas, setPromesas] = useState<VisitaDeCobro[]>([]);
  const [visitasDeHoy, setVisitasDeHoy] = useState<VisitaDeCobro[]>([]);
  const [abonos, setAbonos] = useState<AbonoDeCobrador[]>([]);
  const [entregas, setEntregas] = useState<EntregaDeCobrador[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branch) { setLoading(false); return; }
    setLoading(true);
    const hoy = hoyLocal();
    const desdeHoy = new Date(`${hoy}T00:00:00`).toISOString();
    // Lo de hoy (para «cobrado hoy») y todo lo que sigue en la calle.
    const filtroAbonos = `date.gte.${desdeHoy},and(en_calle.eq.true,settlement_id.is.null)`;
    const columnasAbono = 'id, collector_id, customer_id, amount, method, date, en_calle, settlement_id, voided_at';
    // PostgREST corta en 1000 filas sin avisar: todo lo que puede crecer va por páginas.
    const [c, a, prom, deHoy, lp, cp, e] = await Promise.all([
      supabase.from('collectors').select('id, branch_id, profile_id, is_active, profiles(name)').eq('branch_id', branch),
      fetchAllRows((d, h) => supabase.from('collection_assignments').select('*').eq('branch_id', branch).order('id').range(d, h)),
      fetchAllRows((d, h) => supabase.from('collection_visits').select('*').eq('branch_id', branch)
        .eq('outcome', 'promesa').gte('promise_date', hoy).order('id').range(d, h)),
      fetchAllRows((d, h) => supabase.from('collection_visits').select('*').eq('branch_id', branch)
        .gte('created_at', desdeHoy).order('id').range(d, h)),
      fetchAllRows((d, h) => supabase.from('loan_payments').select(`${columnasAbono}, loan_id`).eq('branch_id', branch)
        .not('collector_id', 'is', null).or(filtroAbonos).order('id').range(d, h)),
      fetchAllRows((d, h) => supabase.from('credit_payments').select(`${columnasAbono}, sale_id`).eq('branch_id', branch)
        .not('collector_id', 'is', null).or(filtroAbonos).order('id').range(d, h)),
      supabase.from('collector_settlements').select('*').eq('branch_id', branch)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setCobradores((c.data ?? []).map(rowToCobrador).sort((x, y) => x.name.localeCompare(y.name, 'es')));
    setAsignaciones(a.map(rowToAsignacion));
    setPromesas(prom.map(rowToVisita));
    setVisitasDeHoy(deHoy.map(rowToVisita).sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
    setAbonos([
      ...lp.map((r) => rowToAbonoDeCobrador('prestamo', r)),
      ...cp.map((r) => rowToAbonoDeCobrador('venta', r)),
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
      p_request_id: abono.requestId ?? null,
    });
    if (error) throw error;
    await reload();
    if ((data as any)?.repetido) {
      const r = data as any;
      return {
        paymentId: r.payment_id, aplicado: Number(r.principal_paid ?? 0), mora: Number(r.late_fee_paid ?? 0),
        saldo: null, enCalle: !!r.en_calle, repetido: true,
      };
    }
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

  /** `esperado` es lo que vio el cajero: si cambió mientras contaba, la base lo rechaza. */
  const recibirEntrega = async (collectorId: string, recibido: number, nota: string | undefined, esperado: number): Promise<EntregaRecibida> => {
    const { data, error } = await supabase.rpc('cobranza_recibir_entrega', {
      p_collector_id: collectorId, p_received: recibido, p_note: nota?.trim() || null, p_expected: esperado,
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
    branchId: branch, cobradores, asignaciones, promesas, visitasDeHoy, abonos, abonosSinEntregar, entregas, miCobrador,
    loading, reload, registrarAbono, registrarVisita, recibirEntrega, asignar, quitarAsignacion, ordenar, marcarCobrador,
  };
}

export type ClienteDeCobro = {
  id: string;
  name: string;
  nickname?: string;
  zone?: string;
  collectionAddress?: string;
  collectionReference?: string;
  phone?: string;
};

/**
 * Las cuentas abiertas de la sucursal (préstamos y ventas a crédito o
 * financiadas), con la mora de la política de siempre, listas para la ruta, y
 * los clientes con sus datos de cobranza. Se piden aquí, por páginas, y no a los
 * providers de la app: esos cortan en 1000 filas y una sucursal con historia
 * perdería cuentas y nombres sin aviso.
 */
export function useCuentasDeCobro(branchId?: string) {
  const { appUser } = useAuth();
  const branch = branchId ?? appUser?.activeBranchId ?? '';
  const { profile } = useCompanyProfile();
  const [prestamos, setPrestamos] = useState<ReturnType<typeof rowToLoan>[]>([]);
  const [ventas, setVentas] = useState<ReturnType<typeof rowToSale>[]>([]);
  const [clientes, setClientes] = useState<Map<string, ClienteDeCobro>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branch) { setLoading(false); return; }
    setLoading(true);
    try {
      const [l, s, c] = await Promise.all([
        fetchAllRows((d, h) => supabase.from('loans').select('*, loan_installments(*)').eq('branch_id', branch)
          .not('status', 'in', '(paid,refinanced,cancelled)').order('id').range(d, h)),
        fetchAllRows((d, h) => supabase.from('sales').select('*, financing_installments(*)').eq('branch_id', branch)
          .in('payment_status', ['credit', 'in_financing']).is('cancelled_at', null).order('id').range(d, h)),
        fetchAllRows((d, h) => supabase.from('customers')
          .select('id, name, nickname, zone, collection_address, collection_reference, phone').order('id').range(d, h)),
      ]);
      setPrestamos(l.map(rowToLoan));
      setVentas(s.map(rowToSale));
      setClientes(new Map(c.map((r: any) => [r.id, {
        id: r.id, name: r.name ?? 'Cliente', nickname: r.nickname ?? undefined, zone: r.zone ?? undefined,
        collectionAddress: r.collection_address ?? undefined, collectionReference: r.collection_reference ?? undefined,
        phone: r.phone ?? undefined,
      }])));
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { reload(); }, [reload]);

  const cuentas = useMemo(() => {
    const hoy = hoyLocal();
    const lista: CuentaDeCobro[] = [];
    for (const l of prestamos) {
      if (!l.customerId) continue;
      const st = calculateLoanStatus(l, profile.loanLateFeeRate, profile.loanLateFeeGraceDays);
      if (st.pendingBalance <= 0.005) continue;
      lista.push(cuentaDesdeCuotas({
        tipo: 'prestamo', id: l.id, customerId: l.customerId, branchId: branch,
        pendiente: st.pendingBalance, mora: st.lateFee, cuotas: l.installments ?? [],
      }, hoy));
    }
    for (const s of ventas) {
      if (!s.customerId) continue;
      // Con plan de cuotas, el cálculo de Financiamientos; a crédito simple, lo que falta.
      if (s.installments?.length) {
        const st = calculateFinancingStatus(s, profile.lateFeeRate, profile.lateFeeGraceDays);
        if (st.pendingBalance <= 0.005) continue;
        lista.push(cuentaDesdeCuotas({
          tipo: 'venta', id: s.id, customerId: s.customerId, branchId: branch,
          pendiente: st.pendingBalance, mora: st.lateFee, cuotas: s.installments,
        }, hoy));
      } else {
        const pendiente = Math.round((s.total - s.amountPaid) * 100) / 100;
        if (pendiente <= 0.005) continue;
        lista.push(cuentaDesdeCuotas({
          tipo: 'venta', id: s.id, customerId: s.customerId, branchId: branch, pendiente, mora: 0, cuotas: [],
        }, hoy));
      }
    }
    return lista;
  }, [prestamos, ventas, branch, profile.lateFeeRate, profile.lateFeeGraceDays, profile.loanLateFeeRate, profile.loanLateFeeGraceDays]);

  return { cuentas, clientes, loading, reload };
}
