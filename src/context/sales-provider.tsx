'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Sale, PaymentMethod, PaymentResult } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { useRealtimeReload } from '@/lib/use-realtime-reload';
import { rowToSale, saleToRow, rowToPaymentResult } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';
import { useSharing } from '@/context/sharing-provider';

interface SalesContextType {
  sales: Sale[];
  /**
   * Ventas a crédito y financiadas del ámbito 'financiamiento'. Son `sales`
   * más las de las otras sucursales del pool, para que se puedan cobrar desde
   * cualquiera de ellas sin que el resto de la app vea ventas ajenas.
   */
  financingSales: Sale[];
  addSale: (sale: Omit<Sale, 'id'>) => Promise<Sale>;
  /** Abono a una venta a crédito o financiada (RPC atómica en la base). */
  paySale: (saleId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string) => Promise<PaymentResult>;
  /** Abono a la deuda general del cliente; la base lo aplica FIFO a sus ventas a crédito. */
  payCustomerDebt: (customerId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string) => Promise<PaymentResult>;
  /** Anula una venta pagada: emite nota de crédito B04 (si llevó NCF), repone
   *  inventario y registra la salida de caja si se devuelve efectivo. */
  annulSale: (saleId: string, reason?: string, refundMethod?: PaymentMethod) => Promise<AnnulSaleResult>;
  reload: () => Promise<void>;
  loading: boolean;
}

export type AnnulSaleResult = {
  creditNoteId: string;
  ncf?: string;
  ncfModified?: string;
  total: number;
  refundMethod: PaymentMethod;
};

const SalesContext = createContext<SalesContextType | undefined>(undefined);

// La app identifica sucursales por nombre; la base usa uuid.
export const resolveBranchId = async (branchName?: string): Promise<string | null> => {
  if (!branchName) return null;
  const { data } = await supabase.from('branches').select('id').eq('name', branchName).maybeSingle();
  return data?.id ?? null;
};

const SALE_SELECT = '*, sale_items(*), customers(*), branches(name), financing_installments(*)';

export function SalesProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const { branchesFor, loading: sharingLoading } = useSharing();
  const [sales, setSales] = useState<Sale[]>([]);
  const [sharedFinancing, setSharedFinancing] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const activeBranchId = appUser?.activeBranchId;
  // Solo las OTRAS sucursales del pool: las propias ya vienen en `sales`.
  const otrasKey = branchesFor('financiamiento').filter((b) => b !== activeBranchId).join(',');

  const load = useCallback(async () => {
    if (!activeBranchId) return;
    const { data, error } = await supabase
      .from('sales')
      .select(SALE_SELECT)
      .eq('branch_id', activeBranchId)
      .order('created_at', { ascending: false });
    if (!error && data) setSales(data.map(rowToSale));
    setLoading(false);
  }, [activeBranchId]);

  // Segunda consulta solo si la empresa comparte financiamiento de verdad; una
  // sucursal aislada no paga ningún viaje extra.
  const loadSharedFinancing = useCallback(async () => {
    if (sharingLoading) return;
    const otras = otrasKey.split(',').filter(Boolean);
    if (otras.length === 0) { setSharedFinancing([]); return; }
    const { data, error } = await supabase
      .from('sales')
      .select(SALE_SELECT)
      .in('branch_id', otras)
      .in('payment_status', ['credit', 'in_financing'])
      .order('created_at', { ascending: false });
    if (!error && data) setSharedFinancing(data.map(rowToSale));
  }, [sharingLoading, otrasKey]);

  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadSharedFinancing()]);
  }, [load, loadSharedFinancing]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Una venta hecha en otra caja aparece aquí sola: en Movimientos, en el
  // dashboard y en todo lo que lea de este provider.
  useRealtimeReload('sales', reloadAll);

  const financingSales = [
    ...sales.filter((s) => s.paymentStatus === 'credit' || s.paymentStatus === 'in_financing'),
    ...sharedFinancing,
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const addSale = async (saleData: Omit<Sale, 'id'>): Promise<Sale> => {
    let branchUuid: string | null = null;
    if (appUser && saleData.branchId === appUser.branch && appUser.activeBranchId) {
      branchUuid = appUser.activeBranchId;
    } else {
      branchUuid = await resolveBranchId(saleData.branchId);
    }
    // El NCF lo asigna el trigger set_sale_ncf en la base (atómico, desde
    // ncf_sequences y solo si la empresa tiene ncf_enabled).
    const { data: sale, error } = await supabase.rpc('create_sale_with_items', {
      p_sale: saleToRow(saleData, branchUuid),
      p_items: saleData.items.map((item) => ({
        product_id: item.product.id || null,
        product_name: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        custom_price: item.customPrice ?? null,
        itbis: item.product.itbis,
        unit: item.product.unit,
      })),
    });
    if (error) throw error;
    // Venta originada en una cotización: marcarla como convertida.
    if (saleData.quoteId) {
      await supabase.from('quotes').update({ status: 'converted' }).eq('id', saleData.quoteId);
    }
    // Canjea el cupón (valida en el servidor que siga activo y no vencido).
    // La venta ya quedó registrada; si el canje falla (p. ej. carrera rara con
    // otra venta) no se revierte la venta, solo queda sin marcar el cupón.
    if (saleData.couponId && sale) {
      const { error: couponError } = await supabase.rpc('redeem_coupon', {
        p_coupon_id: saleData.couponId,
        p_sale_id: sale.id,
      });
      if (couponError) console.error('No se pudo canjear el cupón:', couponError.message);
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
  const paySale = async (saleId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string): Promise<PaymentResult> => {
    const branchUuid = await resolveBranchId(branchName);
    const customerId = sales.find((s) => s.id === saleId)?.customerId;
    const { data, error } = await supabase.rpc('register_sale_payment', {
      p_sale_id: saleId,
      p_amount: amount,
      p_method: method,
      p_branch_id: branchUuid,
      p_notes: notes ?? null,
      p_reference: reference ?? null,
    });
    if (error) throw error;
    await load();
    const result = rowToPaymentResult(data);
    // Recibo por correo, best-effort (no bloquea ni revierte el abono si falla).
    if (customerId) {
      supabase.functions.invoke('send-payment-receipt', {
        body: {
          customerId, amount, lateFeePaid: result.lateFeePaid,
          remainingBalance: result.remainingBalance, kind: 'credit',
        },
      }).catch(() => {});
    }
    return result;
  };

  const payCustomerDebt = async (customerId: string, amount: number, method: PaymentMethod, branchName: string, notes?: string, reference?: string): Promise<PaymentResult> => {
    const branchUuid = await resolveBranchId(branchName);
    const { data, error } = await supabase.rpc('register_customer_payment', {
      p_customer_id: customerId,
      p_amount: amount,
      p_method: method,
      p_branch_id: branchUuid,
      p_notes: notes ?? null,
      p_reference: reference ?? null,
    });
    if (error) throw error;
    await load();
    const result = rowToPaymentResult(data);
    supabase.functions.invoke('send-payment-receipt', {
      body: {
        customerId, amount, lateFeePaid: result.lateFeePaid,
        remainingBalance: result.remainingBalance, kind: 'credit',
      },
    }).catch(() => {});
    return result;
  };

  // La anulación completa (NCF B04, inventario, caja, cancelled_at) ocurre en
  // una sola transacción dentro de la base; aquí solo se refresca el estado.
  const annulSale = async (saleId: string, reason?: string, refundMethod?: PaymentMethod): Promise<AnnulSaleResult> => {
    const { data, error } = await supabase.rpc('annul_sale', {
      p_sale_id: saleId,
      p_reason: reason ?? null,
      p_refund_method: refundMethod ?? null,
    });
    if (error) throw error;
    await load();
    return {
      creditNoteId: data.credit_note_id,
      ncf: data.ncf ?? undefined,
      ncfModified: data.ncf_modified ?? undefined,
      total: Number(data.total ?? 0),
      refundMethod: data.refund_method,
    };
  };

  return (
    <SalesContext.Provider value={{ sales, financingSales, addSale, paySale, payCustomerDebt, annulSale, reload: reloadAll, loading }}>
      {children}
    </SalesContext.Provider>
  );
}

export const useSales = (): SalesContextType => {
  const context = useContext(SalesContext);
  if (context === undefined) throw new Error('useSales must be used within a SalesProvider');
  return context;
};
