'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProduct, productToRow } from '@/lib/supabase/mappers';

export interface BulkImportItem {
  /** null = crear; id = actualizar ese producto existente. */
  existingId: string | null;
  data: Omit<Product, 'id'>;
}

export interface BulkImportResult {
  created: number;
  updated: number;
  failed: { name: string; error: string }[];
}

interface ProductContextType {
  products: Product[];
  updateStock: (productId: string, quantitySold: number) => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  bulkImportProducts: (items: BulkImportItem[], onProgress?: (done: number, total: number) => void) => Promise<BulkImportResult>;
  loading: boolean;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').order('name');
    if (!error && data) setProducts(data.map(rowToProduct));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addProduct = async (productData: Omit<Product, 'id'>) => {
    const { data, error } = await supabase.from('products').insert(productToRow(productData)).select().single();
    if (error) throw error;
    if (data) setProducts((prev) => [...prev, rowToProduct(data)]);
  };

  const updateProduct = async (updated: Product) => {
    const { error } = await supabase.from('products').update(productToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  // Importación por lote: inserta los nuevos en tandas y actualiza los emparejados
  // por código uno a uno. company_id lo pone la base (default current_company_id()).
  const bulkImportProducts = async (
    items: BulkImportItem[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BulkImportResult> => {
    const result: BulkImportResult = { created: 0, updated: 0, failed: [] };
    const total = items.length;
    let done = 0;

    const toCreate = items.filter((i) => !i.existingId);
    const toUpdate = items.filter((i) => i.existingId);

    const BATCH = 200;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH);
      const { error } = await supabase.from('products').insert(batch.map((b) => productToRow(b.data)));
      if (error) {
        // Si el lote falla, insertar fila a fila para reportar cuáles fallaron.
        for (const b of batch) {
          const { error: e2 } = await supabase.from('products').insert(productToRow(b.data));
          if (e2) result.failed.push({ name: b.data.name, error: e2.message });
          else result.created += 1;
        }
      } else {
        result.created += batch.length;
      }
      done += batch.length;
      onProgress?.(done, total);
    }

    for (const b of toUpdate) {
      const { error } = await supabase.from('products').update(productToRow(b.data)).eq('id', b.existingId!);
      if (error) result.failed.push({ name: b.data.name, error: error.message });
      else result.updated += 1;
      done += 1;
      onProgress?.(done, total);
    }

    await load();
    return result;
  };

  const updateStock = async (productId: string, quantitySold: number) => {
    const current = products.find((p) => p.id === productId);
    const newStock = (current?.stock ?? 0) - quantitySold;
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stock: newStock } : p)));
  };

  return (
    <ProductContext.Provider value={{ products, updateStock, addProduct, updateProduct, deleteProduct, bulkImportProducts, loading }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProducts = (): ProductContextType => {
  const context = useContext(ProductContext);
  if (context === undefined) throw new Error('useProducts must be used within a ProductProvider');
  return context;
};
