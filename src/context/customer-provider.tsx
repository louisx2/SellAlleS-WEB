'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Customer } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToCustomer, customerToRow } from '@/lib/supabase/mappers';
import { GENERIC_CUSTOMER } from '@/lib/utils';
import { useAuth } from '@/context/auth-provider';
import { useSharing } from '@/context/sharing-provider';

interface CustomerContextType {
  customers: Customer[];
  /**
   * Los del ámbito 'credito', para Cuentas por Cobrar. Puede diferir de
   * `customers`: se puede compartir el cobro sin compartir la lista.
   */
  creditCustomers: Customer[];
  addCustomer: (customer: Omit<Customer, 'id'>, companyId?: string) => Promise<Customer | undefined>;
  updateCustomer: (customer: Customer) => Promise<void>;
  getGenericCustomer: () => Customer;
  /** Recarga desde la base; el credit_balance lo escribe solo el servidor. */
  reload: () => Promise<void>;
  loading: boolean;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

/**
 * Un cliente sin sucursal es de la empresa entera: se creó antes de que
 * `customers.branch_id` existiera y nadie lo ha reclamado. Se ve desde
 * cualquier sucursal en vez de desaparecer de todas.
 */
const visible = (list: Customer[], branchIds: string[]) =>
  list.filter((c) => !c.branchId || branchIds.includes(c.branchId));

export function CustomerProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const { branchesFor, loading: sharingLoading } = useSharing();
  const [all, setAll] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const activeBranchId = appUser?.activeBranchId;
  const clientesBranches = branchesFor('clientes');
  const creditoBranches = branchesFor('credito');
  // Serializado para no re-disparar la consulta en cada render: los arrays
  // salen de un useCallback, pero son instancias nuevas.
  const clientesKey = clientesBranches.join(',');
  const creditoKey = creditoBranches.join(',');

  const load = useCallback(async () => {
    if (sharingLoading) return;
    // Sin sucursal activa no hay nada que mostrar, pero hay que soltar el
    // spinner: si no, la pantalla se queda cargando para siempre.
    if (!activeBranchId) { setAll([]); setLoading(false); return; }
    // Se traen los dos ámbitos de una vez y se reparten en memoria; son dos
    // listas de la misma tabla y no vale la pena pagar dos viajes.
    const branchIds = Array.from(new Set([...clientesKey.split(','), ...creditoKey.split(',')].filter(Boolean)));
    const { data, error } = await supabase
      .from('customers')
      .select('*, profiles:created_by(name)')
      .or(`branch_id.is.null,branch_id.in.(${branchIds.join(',')})`)
      .order('name');
    if (!error && data) setAll(data.map(rowToCustomer));
    setLoading(false);
  }, [sharingLoading, activeBranchId, clientesKey, creditoKey]);

  useEffect(() => { load(); }, [load]);

  const customers = visible(all, clientesBranches);
  const creditCustomers = visible(all, creditoBranches);

  const addCustomer = async (customerData: Omit<Customer, 'id'>, companyId?: string) => {
    // El cliente nace en la sucursal activa. Si esa sucursal está en el pool de
    // 'clientes' lo verán todas las del pool; si no, es suyo y de nadie más.
    // Sin sucursal activa queda NULL (de la empresa).
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
      setAll((prev) => [...prev, mapped]);
      return mapped;
    }
  };

  const updateCustomer = async (updated: Customer) => {
    const { error } = await supabase.from('customers').update(customerToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setAll((prev) => prev.map((c) => (c.id === updated.id ? { ...updated, branchId: c.branchId } : c)));
  };

  const getGenericCustomer = (): Customer => GENERIC_CUSTOMER;

  return (
    <CustomerContext.Provider value={{ customers, creditCustomers, addCustomer, updateCustomer, getGenericCustomer, reload: load, loading }}>
      {children}
    </CustomerContext.Provider>
  );
}

export const useCustomers = (): CustomerContextType => {
  const context = useContext(CustomerContext);
  if (context === undefined) throw new Error('useCustomers must be used within a CustomerProvider');
  return context;
};
