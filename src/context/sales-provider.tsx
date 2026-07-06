'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Sale, CreditPayment } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSale, saleToRow, saleUpdateToRow, saleItemToRow, creditPaymentToRow } from '@/lib/supabase/mappers';

interface SalesContextType {
  sales: Sale[];
  addSale: (sale: Omit<Sale, 'id'>) => Promise<Sale>;
  updateSale: (sale: Sale) => Promise<void>;
  addCreditPayment: (payment: Omit<CreditPayment, 'id'>) => Promise<void>;
  loading: boolean;
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

// La app identifica sucursales por nombre; la base usa uuid.
const resolveBranchId = async (branchName?: string): Promise<string | null> => {
  if (!branchName) return null;
  const { data } = await supabase.from('branches').select('id').eq('name', branchName).maybeSingle();
  return data?.id ?? null;
};

export function SalesProvider({ children }: { children: ReactNode }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sales')
      .select('*, sale_items(*), customers(*), branches(name)')
      .order('created_at', { ascending: false });
    if (!error && data) setSales(data.map(rowToSale));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addSale = async (saleData: Omit<Sale, 'id'>): Promise<Sale> => {
    const branchUuid = await resolveBranchId(saleData.branchId);
    // El NCF lo asigna el trigger set_sale_ncf en la base (atómico, desde
    // ncf_sequences y solo si la empresa tiene ncf_enabled).
    const { data: sale, error } = await supabase
      .from('sales')
      .insert(saleToRow(saleData, branchUuid))
      .select()
      .single();
    if (error) throw error;
    if (sale && saleData.items?.length) {
      const rows = saleData.items.map((it) => saleItemToRow(it, sale.id));
      const { error: itemsError } = await supabase.from('sale_items').insert(rows);
      if (itemsError) throw itemsError;
    }
    await load();
    // Venta tal como quedó en la base (id y NCF reales) para el recibo.
    return {
      ...saleData,
      id: sale.id,
      ncf: sale.ncf ?? undefined,
      createdAt: new Date(sale.created_at),
    };
  };

  const updateSale = async (updated: Sale) => {
    const { error } = await supabase.from('sales').update(saleUpdateToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setSales((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const addCreditPayment = async (payment: Omit<CreditPayment, 'id'>) => {
    const branchUuid = await resolveBranchId(payment.branchId);
    const { error } = await supabase.from('credit_payments').insert(creditPaymentToRow(payment, branchUuid));
    if (error) throw error;
  };

  return (
    <SalesContext.Provider value={{ sales, addSale, updateSale, addCreditPayment, loading }}>
      {children}
    </SalesContext.Provider>
  );
}

export const useSales = (): SalesContextType => {
  const context = useContext(SalesContext);
  if (context === undefined) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
