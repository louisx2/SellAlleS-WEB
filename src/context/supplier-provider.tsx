'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Supplier } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSupplier } from '@/lib/supabase/mappers';

interface SupplierContextType {
  suppliers: Supplier[];
  loading: boolean;
}

const SupplierContext = createContext<SupplierContextType | undefined>(undefined);

export function SupplierProvider({ children }: { children: ReactNode }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
    if (!error && data) setSuppliers(data.map(rowToSupplier));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SupplierContext.Provider value={{ suppliers, loading }}>
      {children}
    </SupplierContext.Provider>
  );
}

export const useSuppliers = (): SupplierContextType => {
  const context = useContext(SupplierContext);
  if (context === undefined) throw new Error('useSuppliers must be used within a SupplierProvider');
  return context;
};
