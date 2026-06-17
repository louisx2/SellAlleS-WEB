'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Sale } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSale, saleToRow, saleItemToRow } from '@/lib/supabase/mappers';

interface SalesContextType {
  sales: Sale[];
  addSale: (sale: Omit<Sale, 'id'>) => Promise<void>;
  updateSale: (sale: Sale) => Promise<void>;
  loading: boolean;
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

export function SalesProvider({ children }: { children: ReactNode }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sales')
      .select('*, sale_items(*), customers(*)')
      .order('created_at', { ascending: false });
    if (!error && data) setSales(data.map(rowToSale));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addSale = async (saleData: Omit<Sale, 'id'>) => {
    const { data: sale, error } = await supabase.from('sales').insert(saleToRow(saleData)).select().single();
    if (error) throw error;
    if (sale && saleData.items?.length) {
      const rows = saleData.items.map((it) => saleItemToRow(it, sale.id));
      const { error: itemsError } = await supabase.from('sale_items').insert(rows);
      if (itemsError) throw itemsError;
    }
    await load();
  };

  const updateSale = async (updated: Sale) => {
    const { error } = await supabase.from('sales').update(saleToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setSales((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <SalesContext.Provider value={{ sales, addSale, updateSale, loading }}>
      {children}
    </SalesContext.Provider>
  );
}

export const useSales = (): SalesContextType => {
  const context = useContext(SalesContext);
  if (context === undefined) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
