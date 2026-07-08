'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Supplier } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSupplier, supplierToRow } from '@/lib/supabase/mappers';

interface SupplierContextType {
  suppliers: Supplier[];
  addSupplier: (supplier: Omit<Supplier, 'id'>) => Promise<void>;
  updateSupplier: (supplier: Supplier) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
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

  const addSupplier = async (supplierData: Omit<Supplier, 'id'>) => {
    const { data, error } = await supabase.from('suppliers').insert(supplierToRow(supplierData)).select().single();
    if (error) throw error;
    if (data) setSuppliers((prev) => [...prev, rowToSupplier(data)]);
  };

  const updateSupplier = async (updated: Supplier) => {
    const { error } = await supabase.from('suppliers').update(supplierToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const deleteSupplier = async (id: string) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <SupplierContext.Provider value={{ suppliers, addSupplier, updateSupplier, deleteSupplier, loading }}>
      {children}
    </SupplierContext.Provider>
  );
}

export const useSuppliers = (): SupplierContextType => {
  const context = useContext(SupplierContext);
  if (context === undefined) throw new Error('useSuppliers must be used within a SupplierProvider');
  return context;
};
