'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { rowToVehicle, rowToVehicleEvent, rowToVehicleType, vehicleToRow } from '@/lib/supabase/mappers';
import type { Vehicle, VehicleEvent, VehicleType } from '@/lib/types';

// Los embeds van por FK únicas (vehicles.customer_id, vehicles.product_id): no hay
// ambigüedad para PostgREST.
const SELECT = '*, customers(id, name, phone), products(id, name, price)';

export type NewVehicleInput = Partial<Vehicle> & {
  branchId: string;
  origin: Vehicle['origin'];
};

export type VehiclePatch = Partial<Vehicle>;

/** Vehículos de la sucursal activa (o de la que se pida) y los tipos de la empresa. */
export function useVehiculos(opts?: { branchId?: string }) {
  const { appUser } = useAuth();
  const branchId = opts?.branchId ?? appUser?.activeBranchId;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [types, setTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true);
    const [veh, tip] = await Promise.all([
      supabase.from('vehicles').select(SELECT).eq('branch_id', branchId).order('created_at', { ascending: false }),
      supabase.from('vehicle_types').select('*').order('position').order('name'),
    ]);
    setVehicles((veh.data ?? []).map(rowToVehicle));
    setTypes((tip.data ?? []).map(rowToVehicleType));
    setLoading(false);
  }, [branchId]);

  useEffect(() => { reload(); }, [reload]);

  const addVehicle = async (input: NewVehicleInput): Promise<Vehicle> => {
    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        ...vehicleToRow(input),
        branch_id: input.branchId,
        origin: input.origin,
        product_id: input.origin === 'inventario' ? input.productId : null,
        customer_id: input.origin === 'garantia' ? input.customerId : null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;
    await reload();
    return rowToVehicle(data);
  };

  const updateVehicle = async (id: string, patch: VehiclePatch): Promise<void> => {
    const { error } = await supabase.from('vehicles').update(vehicleToRow(patch)).eq('id', id);
    if (error) throw error;
    await reload();
  };

  /** Solo una unidad disponible; el motivo queda en las notas y en el historial. */
  const darDeBaja = async (vehicle: Vehicle, motivo: string): Promise<void> => {
    const notas = [vehicle.notes, `Baja: ${motivo.trim()}`].filter(Boolean).join('\n');
    const { error } = await supabase.from('vehicles').update({ status: 'baja', notes: notas }).eq('id', vehicle.id);
    if (error) throw error;
    await reload();
  };

  return { branchId, vehicles, types, loading, reload, addVehicle, updateVehicle, darDeBaja };
}

/** Un vehículo por id, sin importar la sucursal activa (la ficha se abre por enlace). */
export async function fetchVehicle(id: string): Promise<Vehicle | null> {
  const { data } = await supabase.from('vehicles').select(SELECT).eq('id', id).maybeSingle();
  return data ? rowToVehicle(data) : null;
}

/** Historial del vehículo, lo más nuevo primero. */
export async function fetchVehicleEvents(id: string): Promise<VehicleEvent[]> {
  const { data, error } = await supabase
    .from('vehicle_events').select('*').eq('vehicle_id', id).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToVehicleEvent);
}
