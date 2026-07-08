'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Sale, PaymentMethod, PaymentResult } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSale, saleToRow, saleItemToRow, rowToPaymentResult } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

interface SalesContextType {
  sales: Sale[];
  addSale: (sale: Omit<Sale, 'id'>) => Promise<Sale>;
  /** Abono a una venta a crédito o financiada (RPC atómica en la base). */
  paySale: (saleId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string) => Promise<PaymentResult>;
  /** Abono a la deuda general del cliente; la base lo aplica FIFO a sus ventas a crédito. */
  payCustomerDebt: (customerId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string) => Promise<PaymentResult>;
  reload: () => Promise<void>;
  loading: boolean;
}

const SalesContext = createContext<SalesContextType | undefined>(undefined);

// La app identifica sucursales por nombre; la base usa uuid.
export const resolveBranchId = async (branchName?: string): Promise<string | null> => {
  if (!branchName) return null;
  const { data } = await supabase.from('branches').select('id').eq('name', branchName).maybeSingle();
  return data?.id ?? null;
};

export function SalesProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('sales')
      .select('*, sale_items(*), customers(*), branches(name), financing_installments(*)')
      .order('created_at', { ascending: false });
    if (!error && data) setSales(data.map(rowToSale));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addSale = async (saleData: Omit<Sale, 'id'>): Promise<Sale> => {
    let branchUuid: string | null = null;
    if (appUser && saleData.branchId === appUser.branch && appUser.activeBranchId) {
      branchUuid = appUser.activeBranchId;
    } else {
      branchUuid = await resolveBranchId(saleData.branchId);
    }
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
    // Venta originada en una cotización: marcarla como convertida.
    if (saleData.quoteId) {
      await supabase.from('quotes').update({ status: 'converted' }).eq('id', saleData.quoteId);
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

  // Toda la contabilidad del abono (cuotas, mora, amount_paid, credit_balance)
  // ocurre en una sola transacción dentro de la base.
  const paySale = async (saleId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string): Promise<PaymentResult> => {
    const branchUuid = await resolveBranchId(branchName);
    const { data, error } = await supabase.rpc('register_sale_payment', {
      p_sale_id: saleId,
      p_amount: amount,
      p_method: method,
      p_branch_id: branchUuid,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    await load();
    return rowToPaymentResult(data);
  };

  const payCustomerDebt = async (customerId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string): Promise<PaymentResult> => {
    const branchUuid = await resolveBranchId(branchName);
    const { data, error } = await supabase.rpc('register_customer_payment', {
      p_customer_id: customerId,
      p_amount: amount,
      p_method: method,
      p_branch_id: branchUuid,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    await load();
    return rowToPaymentResult(data);
  };

  return (
    <SalesContext.Provider value={{ sales, addSale, paySale, payCustomerDebt, reload: load, loading }}>
      {children}
    </SalesContext.Provider>
  );
}

export const useSales = (): SalesContextType => {
  const context = useContext(SalesContext);
  if (context === undefined) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
