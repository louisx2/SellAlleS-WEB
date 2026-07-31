'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { ProductLocation } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { rowToProductLocation, productLocationToRow } from '@/lib/supabase/mappers';
import { useAuth } from '@/context/auth-provider';

interface LocationContextType {
  locations: ProductLocation[];
  loading: boolean;
  addLocation: (location: Omit<ProductLocation, 'id'>) => Promise<ProductLocation>;
  updateLocation: (location: ProductLocation) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

// Las ubicaciones son de la sucursal activa y no se comparten: un estante es un
// mueble, está en un sitio. Por eso aquí no hay pool que consultar.
export function LocationProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  const [locations, setLocations] = useState<ProductLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const activeBranchId = appUser?.activeBranchId;

  const load = useCallback(async () => {
    if (!activeBranchId) { setLocations([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('product_locations')
      .select('*')
      .eq('branch_id', activeBranchId)
      .order('name');
    if (!error && data) {
      setLocations(data.map(rowToProductLocation));
    }
    setLoading(false);
  }, [activeBranchId]);

  useEffect(() => {
    load();
  }, [load]);

  const addLocation = async (locationData: Omit<ProductLocation, 'id'>) => {
    if (!activeBranchId) throw new Error('No hay sucursal activa');
    const { data, error } = await supabase
      .from('product_locations')
      .insert({ ...productLocationToRow(locationData), branch_id: activeBranchId })
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
