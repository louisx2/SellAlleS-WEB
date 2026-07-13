'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Branch } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToBranch, branchToRow } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

interface BranchContextType {
  branches: Branch[];
  addBranch: (branch: Omit<Branch, 'id'>) => Promise<void>;
  updateBranch: (branch: Branch) => Promise<void>;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  // Empresa activa: la impersonada si el super admin entró a un tenant, si no la propia.
  // El super admin ignora RLS (ve todas las empresas), así que sin este filtro el
  // selector de sucursales mostraría las de TODAS las empresas.
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setBranches([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('company_id', activeCompanyId)
      .order('name');
    if (!error && data) setBranches(data.map(rowToBranch));
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const addBranch = async (branchData: Omit<Branch, 'id'>) => {
    const { data, error } = await supabase.from('branches').insert(branchToRow(branchData)).select().single();
    if (error) throw error;
    if (data) setBranches((prev) => [...prev, rowToBranch(data)]);
  };

  const updateBranch = async (updated: Branch) => {
    const { error } = await supabase.from('branches').update(branchToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  return (
    <BranchContext.Provider value={{ branches, addBranch, updateBranch, loading }}>
      {children}
    </BranchContext.Provider>
  );
}

export const useBranches = (): BranchContextType => {
  const context = useContext(BranchContext);
  if (context === undefined) throw new Error('useBranches must be used within a BranchProvider');
  return context;
};
