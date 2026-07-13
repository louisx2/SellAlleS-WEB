'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { ProductCategory } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProductCategory, productCategoryToRow } from '@/lib/supabase/mappers';

interface CategoryContextType {
  categories: ProductCategory[];
  loading: boolean;
  addCategory: (category: Omit<ProductCategory, 'id'>) => Promise<ProductCategory>;
  updateCategory: (category: ProductCategory) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

export function CategoryProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('product_categories').select('*').order('name');
    if (!error && data) {
      setCategories(data.map(rowToProductCategory));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addCategory = async (categoryData: Omit<ProductCategory, 'id'>) => {
    const { data, error } = await supabase
      .from('product_categories')
      .insert(productCategoryToRow(categoryData))
      .select()
      .single();
    if (error) throw error;
    const created = rowToProductCategory(data);
    setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const updateCategory = async (updated: ProductCategory) => {
    const { error } = await supabase
      .from('product_categories')
      .update(productCategoryToRow(updated))
      .eq('id', updated.id);
    if (error) throw error;
    setCategories((prev) =>
      prev
        .map((c) => (c.id === updated.id ? updated : c))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  const deleteCategory = async (id: string) => {
    const { error } = await supabase
      .from('product_categories')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <CategoryContext.Provider value={{ categories, loading, addCategory, updateCategory, deleteCategory }}>
      {children}
    </CategoryContext.Provider>
  );
}

export const useCategories = (): CategoryContextType => {
  const context = useContext(CategoryContext);
  if (context === undefined) {
    throw new Error('useCategories must be used within a CategoryProvider');
  }
  return context;
};
