'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Expense } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToExpense } from '@/lib/supabase/mappers';

interface ExpenseContextType {
  expenses: Expense[];
  loading: boolean;
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('expenses').select('*').order('date', { ascending: false });
    if (!error && data) setExpenses(data.map(rowToExpense));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <ExpenseContext.Provider value={{ expenses, loading }}>
      {children}
    </ExpenseContext.Provider>
  );
}

export const useExpenses = (): ExpenseContextType => {
  const context = useContext(ExpenseContext);
  if (context === undefined) throw new Error('useExpenses must be used within a ExpenseProvider');
  return context;
};
