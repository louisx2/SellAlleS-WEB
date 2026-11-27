'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import {
  rowToChecklistItem, rowToEquipmentType, rowToServiceType, rowToStaff, rowToTallerSettings,
} from '@/lib/supabase/mappers';
import type { ChecklistItem, EquipmentType, ServiceType, Staff, TallerSettings, Technician } from '@/lib/types';

export type TallerConfig = {
  branchId?: string;
  equipmentTypes: EquipmentType[];
  checklist: ChecklistItem[];
  /** Catálogo de la sucursal activa (más los viejos sin sucursal). */
  catalog: ServiceType[];
  technicians: Technician[];
  /** Personas de la sucursal, activas e inactivas, en orden. */
  staff: Staff[];
  /** Ids de las personas ligadas al usuario actual. */
  myStaffIds: string[];
  settings: TallerSettings | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/** Configuración del taller para la sucursal activa. Los tipos de equipo y los
 *  chequeos son de la empresa; catálogo, técnicos y ajustes, de la sucursal. */
export function useTallerConfig(): TallerConfig {
  const { appUser } = useAuth();
  const branchId = appUser?.activeBranchId;
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentType[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [catalog, setCatalog] = useState<ServiceType[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [settings, setSettings] = useState<TallerSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true);
    const [eq, ck, cat, tec, st, sf] = await Promise.all([
      supabase.from('service_equipment_types').select('*').order('position').order('name'),
      supabase.from('service_checklist_items').select('*').order('position').order('label'),
      supabase.from('service_types').select('*, products(price, itbis)')
        .or(`branch_id.eq.${branchId},branch_id.is.null`).order('position').order('name'),
      supabase.from('service_technicians').select('id, profile_id, profiles(name)').eq('branch_id', branchId),
      supabase.from('taller_settings').select('*').eq('branch_id', branchId).maybeSingle(),
      supabase.from('service_staff').select('*').eq('branch_id', branchId).order('position').order('name'),
    ]);
    setEquipmentTypes((eq.data ?? []).map(rowToEquipmentType));
    setChecklist((ck.data ?? []).map(rowToChecklistItem));
    setCatalog((cat.data ?? []).map(rowToServiceType));
    setTechnicians(
      (tec.data ?? [])
        .map((t: any) => ({ id: t.id, profileId: t.profile_id, name: t.profiles?.name ?? 'Sin nombre' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setStaff((sf.data ?? []).map(rowToStaff));
    setSettings(st.data ? rowToTallerSettings(st.data) : null);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { reload(); }, [reload]);

  const myStaffIds = useMemo(
    () => staff.filter((p) => p.profileId && p.profileId === appUser?.id).map((p) => p.id),
    [staff, appUser?.id],
  );

  return { branchId, equipmentTypes, checklist, catalog, technicians, staff, myStaffIds, settings, loading, reload };
}
