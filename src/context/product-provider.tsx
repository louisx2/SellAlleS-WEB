'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProduct, productToRow } from '@/lib/supabase/mappers';

interface ProductContextType {
  products: Product[];
  updateStock: (productId: string, quantitySold: number) => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (product: Product) => Promise<void>;
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

  const updateStock = async (productId: string, quantitySold: number) => {
    const current = products.find((p) => p.id === productId);
    const newStock = (current?.stock ?? 0) - quantitySold;
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stock: newStock } : p)));
  };

  return (
    <ProductContext.Provider value={{ products, updateStock, addProduct, updateProduct, loading }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProducts = (): ProductContextType => {
  const context = useContext(ProductContext);
  if (context === undefined) throw new Error('useProducts must be used within a ProductProvider');
  return context;
};
