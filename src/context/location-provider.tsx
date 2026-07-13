'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { ProductLocation } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProductLocation, productLocationToRow } from '@/lib/supabase/mappers';

interface LocationContextType {
  locations: ProductLocation[];
  loading: boolean;
  addLocation: (location: Omit<ProductLocation, 'id'>) => Promise<ProductLocation>;
  updateLocation: (location: ProductLocation) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [locations, setLocations] = useState<ProductLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('product_locations').select('*').order('name');
    if (!error && data) {
      setLocations(data.map(rowToProductLocation));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addLocation = async (locationData: Omit<ProductLocation, 'id'>) => {
    const { data, error } = await supabase
      .from('product_locations')
      .insert(productLocationToRow(locationData))
      .select()
      .single();
    if (error) throw error;
    const created = rowToProductLocation(data);
    setLocations((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  };

  const updateLocation = async (updated: ProductLocation) => {
    const { error } = await supabase
      .from('product_locations')
      .update(productLocationToRow(updated))
      .eq('id', updated.id);
    if (error) throw error;
    setLocations((prev) =>
      prev
        .map((l) => (l.id === updated.id ? updated : l))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  const deleteLocation = async (id: string) => {
    const { error } = await supabase
      .from('product_locations')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setLocations((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <LocationContext.Provider value={{ locations, loading, addLocation, updateLocation, deleteLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export const useLocations = (): LocationContextType => {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocations must be used within a LocationProvider');
  }
  return context;
};
