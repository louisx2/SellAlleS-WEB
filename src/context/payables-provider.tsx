'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { PaymentMethod, SupplierInvoice, SupplierPaymentResult } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToSupplierInvoice, rowToSupplierPaymentResult } from '@/lib/supabase/mappers';
import { resolveBranchId } from '@/context/sales-provider';
import { useAuth } from '@/context/auth-provider';

// Línea de una factura nueva. productId presente + módulo 'purchases' activo
// = la cantidad entra al inventario (lo hace la RPC en la misma transacción).
export type NewSupplierInvoiceItem = {
  productId?: string;
  description: string;
  quantity: number;
  unitCost: number;
  itbisAmount: number;
};

// Payload de la RPC create_supplier_invoice. El total lo calcula el servidor;
// los campos fiscales quedan en 0/null para empresas informales.
export type NewSupplierInvoice = {
  supplierId: string;
  branchName?: string;   // nombre de sucursal; se resuelve a uuid al guardar
  invoiceNumber?: string;
  issueDate: string;     // yyyy-mm-dd
  dueDate?: string;
  subtotalGoods: number;
  subtotalServices: number;
  ncf?: string;
  ncfModified?: string;
  expenseType?: string;
  itbisFacturado?: number;
  itbisRetenido?: number;
  itbisProporcionalidad?: number;
  itbisLlevadoCosto?: number;
  isrRetentionType?: string;
  isrRetentionAmount?: number;
  impuestoSelectivo?: number;
  otrosImpuestos?: number;
  propinaLegal?: number;
  paymentForm?: string;
  notes?: string;
  initialPayment?: number;      // 0/ausente = todo a crédito
  initialMethod?: PaymentMethod;
  initialReference?: string;
  items?: NewSupplierInvoiceItem[];
};

interface PayablesContextType {
  invoices: SupplierInvoice[];
  addInvoice: (invoice: NewSupplierInvoice) => Promise<void>;
  /** Abono a una factura de suplidor (RPC atómica en la base). */
  payInvoice: (invoiceId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string) => Promise<SupplierPaymentResult>;
  /** Solo facturas sin abonos (la RLS también lo bloquea en la base). */
  deleteInvoice: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  loading: boolean;
}

const PayablesContext = createContext<PayablesContextType | undefined>(undefined);

export function PayablesProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('supplier_invoices')
      .select('*, supplier_invoice_items(*), supplier_payments(*, branches(name)), suppliers(*), branches(name)')
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (!error && data) setInvoices(data.map(rowToSupplierInvoice));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addInvoice = async (inv: NewSupplierInvoice) => {
    let branchUuid: string | null = null;
    if (appUser && inv.branchName === appUser.branch && appUser.activeBranchId) {
      branchUuid = appUser.activeBranchId;
    } else {
      branchUuid = await resolveBranchId(inv.branchName);
    }
    const { error } = await supabase.rpc('create_supplier_invoice', {
      p_supplier_id: inv.supplierId,
      p_issue_date: inv.issueDate,
      p_branch_id: branchUuid,
      p_invoice_number: inv.invoiceNumber ?? null,
      p_due_date: inv.dueDate ?? null,
      p_subtotal_goods: inv.subtotalGoods,
      p_subtotal_services: inv.subtotalServices,
      p_ncf: inv.ncf ?? null,
      p_ncf_modified: inv.ncfModified ?? null,
      p_expense_type: inv.expenseType ?? null,
      p_itbis_facturado: inv.itbisFacturado ?? 0,
      p_itbis_retenido: inv.itbisRetenido ?? 0,
      p_itbis_proporcionalidad: inv.itbisProporcionalidad ?? 0,
      p_itbis_llevado_costo: inv.itbisLlevadoCosto ?? 0,
      p_isr_retention_type: inv.isrRetentionType ?? null,
      p_isr_retention_amount: inv.isrRetentionAmount ?? 0,
      p_impuesto_selectivo: inv.impuestoSelectivo ?? 0,
      p_otros_impuestos: inv.otrosImpuestos ?? 0,
      p_propina_legal: inv.propinaLegal ?? 0,
      p_payment_form: inv.paymentForm ?? null,
      p_notes: inv.notes ?? null,
      p_initial_payment: inv.initialPayment ?? 0,
      p_initial_method: inv.initialMethod ?? 'cash',
      p_initial_reference: inv.initialReference ?? null,
      p_items: (inv.items ?? []).map((it) => ({
        product_id: it.productId ?? null,
        description: it.description,
        quantity: it.quantity,
        unit_cost: it.unitCost,
        itbis_amount: it.itbisAmount,
      })),
    });
    if (error) throw error;
    await load();
  };

  const payInvoice = async (invoiceId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string): Promise<SupplierPaymentResult> => {
    const branchUuid = await resolveBranchId(branchName);
    const { data, error } = await supabase.rpc('register_supplier_payment', {
      p_invoice_id: invoiceId,
      p_amount: amount,
      p_method: method,
      p_branch_id: branchUuid,
      p_notes: notes ?? null,
      p_reference: reference ?? null,
    });
    if (error) throw error;
    await load();
    return rowToSupplierPaymentResult(data);
  };

  const deleteInvoice = async (id: string) => {
    // La RLS filtra facturas con abonos: el delete "funciona" pero borra 0
    // filas. Se pide el id de vuelta para poder avisar al usuario.
    const { data, error } = await supabase.from('supplier_invoices').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('No se pudo eliminar: la factura tiene abonos registrados.');
    setInvoices((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <PayablesContext.Provider value={{ invoices, addInvoice, payInvoice, deleteInvoice, reload: load, loading }}>
      {children}
    </PayablesContext.Provider>
  );
}

export const usePayables = (): PayablesContextType => {
  const context = useContext(PayablesContext);
  if (context === undefined) throw new Error('usePayables must be used within a PayablesProvider');
  return context;
};
