'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { useRealtimeReload } from '@/lib/use-realtime-reload';
import { rowToProduct, productToRow } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

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
  /** Borra el artículo; si ya tiene historial lo archiva y devuelve 'archivado'. */
  deleteProduct: (id: string) => Promise<'eliminado' | 'archivado'>;
  bulkImportProducts: (items: BulkImportItem[], onProgress?: (done: number, total: number) => void) => Promise<BulkImportResult>;
  /** Relee productos de la base (p. ej. tras una compra que sumó stock en el servidor). */
  reload: () => Promise<void>;
  loading: boolean;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { appUser } = useAuth();
  const activeBranchId = appUser?.activeBranchId;

  const load = useCallback(async () => {
    if (!activeBranchId) return;
    // Los archivados no se listan: siguen en la base por su historial de ventas.
    const { data, error } = await supabase.from('products').select('*')
      .eq('branch_id', activeBranchId).eq('is_active', true).order('name');
    if (!error && data) setProducts(data.map(rowToProduct));
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => { load(); }, [load]);

  // El stock lo baja un trigger en la base cada vez que alguien vende, desde
  // cualquier dispositivo. Sin esto, la tablet de al lado seguía anunciando
  // existencias que ya no estaban.
  useRealtimeReload('products', load);

  const addProduct = async (productData: Omit<Product, 'id'>) => {
    if (!activeBranchId) throw new Error('No hay sucursal activa');
    const row = productToRow({ ...productData, branchId: activeBranchId });
    const { data, error } = await supabase.from('products').insert(row).select().single();
    if (error) throw error;
    if (data) setProducts((prev) => [...prev, rowToProduct(data)]);
  };

  const updateProduct = async (updated: Product) => {
    const { error } = await supabase.from('products').update(productToRow(updated)).eq('id', updated.id);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Se intenta borrar de verdad, que es lo que se quiere con un artículo creado
  // por error. Si ya tiene historial (ventas, cotizaciones, servicios o facturas
  // de proveedor), la base lo rechaza con un 23503 y entonces se archiva: sale
  // del POS y del inventario, pero el historial y los reportes por artículo
  // siguen cuadrando. No se comprueba antes a propósito: entre la comprobación y
  // el borrado podría colarse una venta.
  const deleteProduct = async (id: string): Promise<'eliminado' | 'archivado'> => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (!error) {
      setProducts((prev) => prev.filter((p) => p.id !== id));
      return 'eliminado';
    }
    if (error.code !== '23503') throw error;

    const { error: eArchivar } = await supabase
      .from('products').update({ is_active: false }).eq('id', id);
    if (eArchivar) throw eArchivar;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    return 'archivado';
  };

  // Importación por lote: inserta los nuevos en tandas y actualiza los emparejados
  // por código uno a uno. company_id lo pone la base (default current_company_id()).
  const bulkImportProducts = async (
    items: BulkImportItem[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BulkImportResult> => {
    const result: BulkImportResult = { created: 0, updated: 0, failed: [] };
    if (!activeBranchId) {
      result.failed.push({ name: 'Error general', error: 'No hay sucursal activa' });
      return result;
    }
    const total = items.length;
    let done = 0;

    const toCreate = items.filter((i) => !i.existingId);
    const toUpdate = items.filter((i) => i.existingId);

    const BATCH = 200;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH);
      const { error } = await supabase.from('products').insert(batch.map((b) => productToRow({ ...b.data, branchId: activeBranchId })));
      if (error) {
        // Si el lote falla, insertar fila a fila para reportar cuáles fallaron.
        for (const b of batch) {
          const { error: e2 } = await supabase.from('products').insert(productToRow({ ...b.data, branchId: activeBranchId }));
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
    <ProductContext.Provider value={{ products, updateStock, addProduct, updateProduct, deleteProduct, bulkImportProducts, reload: load, loading }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProducts = (): ProductContextType => {
  const context = useContext(ProductContext);
  if (context === undefined) throw new Error('useProducts must be used within a ProductProvider');
  return context;
};
