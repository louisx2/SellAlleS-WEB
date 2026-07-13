'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { CajaSession, CajaCloseResult, CajaMovement } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCajaSession, rowToCajaCloseResult, rowToCajaMovement } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

interface CajaContextType {
  /** Sesión abierta de la sucursal activa, o null si no hay ninguna. */
  session: CajaSession | null;
  isOpen: boolean;
  /** Sesiones cerradas recientes de la sucursal activa. */
  history: CajaSession[];
  openSession: (openingAmount: number, notes?: string) => Promise<CajaSession>;
  closeSession: (sessionId: string, declaredAmount: number, notes?: string) => Promise<CajaCloseResult>;
  addMovement: (type: 'in' | 'out', amount: number, reason?: string) => Promise<CajaMovement>;
  reload: () => Promise<void>;
  loading: boolean;
}

const CajaContext = createContext<CajaContextType | undefined>(undefined);

// Caja es por-sucursal: se filtra por la sucursal activa del usuario
// (activeBranchId, uuid), no por empresa completa como los demás dominios.
export function CajaProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const branchId = appUser?.activeBranchId;
  const [session, setSession] = useState<CajaSession | null>(null);
  const [history, setHistory] = useState<CajaSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchId) { setSession(null); setHistory([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('caja_sessions')
      .select('*, caja_movements(*)')
      .eq('branch_id', branchId)
      .order('opened_at', { ascending: false })
      .limit(30);
    if (!error && data) {
      const rows = data.map(rowToCajaSession);
      setSession(rows.find((s) => s.status === 'open') ?? null);
      setHistory(rows.filter((s) => s.status === 'closed'));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const openSession = async (openingAmount: number, notes?: string): Promise<CajaSession> => {
    const { data, error } = await supabase.rpc('open_caja_session', {
      p_branch_id: branchId, p_opening_amount: openingAmount, p_notes: notes ?? null,
    });
    if (error) throw error;
    await load();
    const created = rowToCajaSession(data);
    // Resumen por correo a admins/gerentes (best-effort; el gate real —
    // activado/desactivado— lo decide la Edge Function server-side).
    supabase.functions.invoke('send-caja-summary', { body: { sessionId: created.id, kind: 'open' } }).catch(() => {});
    return created;
  };

  const closeSession = async (sessionId: string, declaredAmount: number, notes?: string): Promise<CajaCloseResult> => {
    const { data, error } = await supabase.rpc('close_caja_session', {
      p_session_id: sessionId, p_closing_amount_declared: declaredAmount, p_notes: notes ?? null,
    });
    if (error) throw error;
    await load();
    const result = rowToCajaCloseResult(data);
    supabase.functions.invoke('send-caja-summary', { body: { sessionId: result.sessionId, kind: 'close' } }).catch(() => {});
    return result;
  };

  const addMovement = async (type: 'in' | 'out', amount: number, reason?: string): Promise<CajaMovement> => {
    const { data, error } = await supabase.rpc('register_caja_movement', {
      p_branch_id: branchId, p_type: type, p_amount: amount, p_reason: reason ?? null,
    });
    if (error) throw error;
    await load();
    return rowToCajaMovement(data);
  };

  return (
    <CajaContext.Provider value={{
      session, isOpen: session !== null, history,
      openSession, closeSession, addMovement, reload: load, loading,
    }}>
      {children}
    </CajaContext.Provider>
  );
}

export const useCaja = (): CajaContextType => {
  const context = useContext(CajaContext);
  if (context === undefined) throw new Error('useCaja must be used within a CajaProvider');
  return context;
};
