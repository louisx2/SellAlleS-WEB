'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Expense } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToExpense, expenseToRow } from '@/lib/supabase/mappers';
import { resolveBranchId } from '@/context/sales-provider';

interface ExpenseContextType {
  expenses: Expense[];
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<void>;
  updateExpense: (id: string, expense: Omit<Expense, 'id'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  loading: boolean;
}

const ExpenseContext = createContext<ExpenseContextType | undefined>(undefined);

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, branches(name)')
      .order('date', { ascending: false });
    if (!error && data) setExpenses(data.map(rowToExpense));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addExpense = async (expense: Omit<Expense, 'id'>) => {
    const branchUuid = await resolveBranchId(expense.branchId);
    const { error } = await supabase.from('expenses').insert(expenseToRow(expense, branchUuid));
    if (error) throw error;
    await load();
  };

  const updateExpense = async (id: string, expense: Omit<Expense, 'id'>) => {
    const branchUuid = await resolveBranchId(expense.branchId);
    const { error } = await supabase.from('expenses').update(expenseToRow(expense, branchUuid)).eq('id', id);
    if (error) throw error;
    await load();
  };

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
    await load();
  };

  return (
    <ExpenseContext.Provider value={{ expenses, addExpense, updateExpense, deleteExpense, reload: load, loading }}>
      {children}
    </ExpenseContext.Provider>
  );
}

export const useExpenses = (): ExpenseContextType => {
  const context = useContext(ExpenseContext);
  if (context === undefined) throw new Error('useExpenses must be used within a ExpenseProvider');
  return context;
};
