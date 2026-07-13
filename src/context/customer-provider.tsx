'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Customer } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCustomer, customerToRow } from '@/lib/supabase/mappers';
import { GENERIC_CUSTOMER } from '@/lib/utils';
import { useAuth } from '@/context/auth-provider';

interface CustomerContextType {
  customers: Customer[];
  addCustomer: (customer: Omit<Customer, 'id'>, companyId?: string) => Promise<Customer | undefined>;
  updateCustomer: (customer: Customer) => Promise<void>;
  getGenericCustomer: () => Customer;
  /** Recarga desde la base; el credit_balance lo escribe solo el servidor. */
  reload: () => Promise<void>;
  loading: boolean;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);


export function CustomerProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('*, profiles:created_by(name)')
      .order('name');
    if (!error && data) setCustomers(data.map(rowToCustomer));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addCustomer = async (customerData: Omit<Customer, 'id'>, companyId?: string) => {
    // La sucursal activa determina a qué sucursal pertenece el cliente cuando el
    // compartir 'clientes' está apagado. Sin sucursal activa queda NULL (global).
    const activeBranchId = appUser?.activeBranchId || null;
    const row = {
      ...customerToRow(customerData),
      ...(companyId ? { company_id: companyId } : {}),
      ...(activeBranchId ? { branch_id: activeBranchId } : {}),
    };
    const { data, error } = await supabase
      .from('customers')
      .insert(row)
      .select('*, profiles:created_by(name)')
      .single();
    if (error) throw error;
    if (data) {
      const mapped = rowToCustomer(data);
      setCustomers((prev) => [...prev, mapped]);
      return mapped;
    }
  };

  const updateCustomer = async (updated: Customer) => {
    const { error } = await supabase.from('customers').update(customerToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const getGenericCustomer = (): Customer => GENERIC_CUSTOMER;

  return (
    <CustomerContext.Provider value={{ customers, addCustomer, updateCustomer, getGenericCustomer, reload: load, loading }}>
      {children}
    </CustomerContext.Provider>
  );
}

export const useCustomers = (): CustomerContextType => {
  const context = useContext(CustomerContext);
  if (context === undefined) throw new Error('useCustomers must be used within a CustomerProvider');
  return context;
};
