'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';

interface UserContextType {
  users: AppUser[];
  addUser: (user: Omit<AppUser, 'id'>, password?: string) => Promise<void>;
  updateUser: (user: AppUser) => Promise<void>;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      // Desambiguado: profiles↔branches tiene dos relaciones (branch_id y profile_branches).
      .select('id, name, email, role, is_super_admin, branches!profiles_branch_id_fkey(name), profile_roles(roles(id, name, description))');
    if (!error && data) {
      setUsers(
        data.map((d: any) => ({
          id: d.id,
          name: d.name ?? 'Usuario',
          email: d.email ?? '',
          role: d.is_super_admin ? 'admin' : d.role,
          branch: Array.isArray(d.branches) ? d.branches[0]?.name ?? '' : d.branches?.name ?? '',
          customRoles: (d.profile_roles ?? [])
            .map((pr: any) => pr.roles)
            .filter(Boolean)
            .map((r: any) => ({ id: r.id, name: r.name, description: r.description ?? '' }))
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // La creación de usuarios con contraseña se hará vía invitaciones de Supabase
  // (Auth Admin API) en una fase posterior; no se puede crear desde el cliente.
  const addUser = async (_user: Omit<AppUser, 'id'>, _password?: string) => {
    throw new Error('La creación de usuarios se implementará con invitaciones de Supabase.');
  };

  const updateUser = async (updated: AppUser) => {
    let branchId = null;
    if (updated.branch) {
      const { data: branchData } = await supabase
        .from('branches')
        .select('id')
        .eq('name', updated.branch)
        .single();
      if (branchData) branchId = branchData.id;
    }

    const updatePayload: any = {
      name: updated.name,
      role: updated.role,
    };
    
    if (branchId) {
      updatePayload.branch_id = branchId;
    }

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', updated.id);
      
    if (error) throw error;

    // Update custom roles if provided
    if (updated.customRoles) {
      // Borrar roles anteriores
      await supabase.from('profile_roles').delete().eq('profile_id', updated.id);
      
      // Insertar nuevos
      if (updated.customRoles.length > 0) {
        const insertData = updated.customRoles.map(role => ({
          profile_id: updated.id,
          role_id: role.id
        }));
        await supabase.from('profile_roles').insert(insertData);
      }
    }

    // Refresh context
    await load();
  };

  return (
    <UserContext.Provider value={{ users, addUser, updateUser, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUsers = (): UserContextType => {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUsers must be used within a UserProvider');
  return context;
};
