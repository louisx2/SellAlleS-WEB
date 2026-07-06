'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Customer } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCustomer, customerToRow } from '@/lib/supabase/mappers';
import { GENERIC_CUSTOMER } from '@/lib/utils';

interface CustomerContextType {
  customers: Customer[];
  addCustomer: (customer: Omit<Customer, 'id'>) => Promise<void>;
  updateCustomer: (customer: Customer) => Promise<void>;
  getGenericCustomer: () => Customer;
  loading: boolean;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);


export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (!error && data) setCustomers(data.map(rowToCustomer));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addCustomer = async (customerData: Omit<Customer, 'id'>) => {
    const { data, error } = await supabase.from('customers').insert(customerToRow(customerData)).select().single();
    if (error) throw error;
    if (data) setCustomers((prev) => [...prev, rowToCustomer(data)]);
  };

  const updateCustomer = async (updated: Customer) => {
    const { error } = await supabase.from('customers').update(customerToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const getGenericCustomer = (): Customer => GENERIC_CUSTOMER;

  return (
    <CustomerContext.Provider value={{ customers, addCustomer, updateCustomer, getGenericCustomer, loading }}>
      {children}
    </CustomerContext.Provider>
  );
}

export const useCustomers = (): CustomerContextType => {
  const context = useContext(CustomerContext);
  if (context === undefined) throw new Error('useCustomers must be used within a CustomerProvider');
  return context;
};
