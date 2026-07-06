'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { Quote, QuoteStatus, CartItem } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToQuote, quoteToRow, quoteItemToRow } from '@/lib/supabase/mappers';
import { resolveBranchId } from '@/context/sales-provider';

interface QuotesContextType {
  quotes: Quote[];
  addQuote: (quote: Omit<Quote, 'id' | 'items' | 'createdAt'>, items: CartItem[]) => Promise<void>;
  updateQuoteStatus: (id: string, status: QuoteStatus) => Promise<void>;
  reload: () => Promise<void>;
  loading: boolean;
}

const QuotesContext = createContext<QuotesContextType | undefined>(undefined);

export function QuotesProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('quotes')
      .select('*, quote_items(*), customers(*), branches(name)')
      .order('created_at', { ascending: false });
    if (!error && data) setQuotes(data.map(rowToQuote));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const addQuote = async (quoteData: Omit<Quote, 'id' | 'items' | 'createdAt'>, items: CartItem[]) => {
    const branchUuid = await resolveBranchId(quoteData.branchId);
    const { data: quote, error } = await supabase
      .from('quotes')
      .insert(quoteToRow(quoteData, branchUuid))
      .select()
      .single();
    if (error) throw error;
    if (quote && items.length) {
      const rows = items.map((it) => quoteItemToRow(it, quote.id));
      const { error: itemsError } = await supabase.from('quote_items').insert(rows);
      if (itemsError) throw itemsError;
    }
    await reload();
  };

  const updateQuoteStatus = async (id: string, status: QuoteStatus) => {
    const { error } = await supabase.from('quotes').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)));
  };

  return (
    <QuotesContext.Provider value={{ quotes, addQuote, updateQuoteStatus, reload, loading }}>
      {children}
    </QuotesContext.Provider>
  );
}

export const useQuotes = (): QuotesContextType => {
  const context = useContext(QuotesContext);
  if (context === undefined) throw new Error('useQuotes must be used within a QuotesProvider');
  return context;
};
