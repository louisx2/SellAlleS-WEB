'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { ProductCategory } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProductCategory, productCategoryToRow } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';
import { useSharing } from '@/context/sharing-provider';

interface CategoryContextType {
  categories: ProductCategory[];
  loading: boolean;
  addCategory: (category: Omit<ProductCategory, 'id'>) => Promise<ProductCategory>;
  updateCategory: (category: ProductCategory) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

// A diferencia de las ubicaciones, las categorías SÍ se pueden compartir: son
// taxonomía, no muebles. Manda el pool 'categorias', que nace vacío (aislado).
export function CategoryProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const { branchesFor, loading: sharingLoading } = useSharing();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const activeBranchId = appUser?.activeBranchId;
  const branchesKey = branchesFor('categorias').join(',');

  const load = useCallback(async () => {
    if (sharingLoading) return;
    const branchIds = branchesKey.split(',').filter(Boolean);
    if (branchIds.length === 0) { setCategories([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .in('branch_id', branchIds)
      .order('name');
    if (!error && data) {
      setCategories(data.map(rowToProductCategory));
    }
    setLoading(false);
  }, [sharingLoading, branchesKey]);

  useEffect(() => {
    load();
  }, [load]);

  const addCategory = async (categoryData: Omit<ProductCategory, 'id'>) => {
    if (!activeBranchId) throw new Error('No hay sucursal activa');
    // La categoría nace en la sucursal activa aunque el pool sea más ancho: se
    // comparte, pero alguien tiene que ser su dueño.
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ ...productCategoryToRow(categoryData), branch_id: activeBranchId })
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
