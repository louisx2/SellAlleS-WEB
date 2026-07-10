'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';

interface UserContextType {
  users: AppUser[];
  addUser: (user: Omit<AppUser, 'id'>, password?: string) => Promise<void>;
  updateUser: (user: AppUser) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  setPassword: (userId: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth();
  // Empresa activa: la impersonada si el super admin entró a un tenant, si no la propia.
  // Sin este filtro el super admin (que ignora RLS) vería los usuarios de TODAS las empresas.
  const activeCompanyId = appUser?.impersonatedCompanyId || appUser?.companyId;
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) { setUsers([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('profiles')
      // Desambiguado: profiles↔branches tiene dos relaciones (branch_id y profile_branches).
      .select('id, name, email, role, is_super_admin, branches!profiles_branch_id_fkey(name), profile_roles(roles(id, name, description))')
      .eq('company_id', activeCompanyId);
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
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  // La creación de usuarios con contraseña se hará vía invitaciones de Supabase
  // (Auth Admin API) en una fase posterior; no se puede crear desde el cliente.
  const addUser = async (_user: Omit<AppUser, 'id'>, _password?: string) => {
    throw new Error('La creación de usuarios se implementará con invitaciones de Supabase.');
  };

  const updateUser = async (updated: AppUser) => {
    let branchId = null;
    if (updated.branch) {
      // Resolver la sucursal por nombre DENTRO de la empresa activa: varios
      // tenants comparten nombres ("Principal"), así que sin el filtro por
      // company_id se podría agarrar la sucursal de otra empresa.
      let branchQuery = supabase.from('branches').select('id').eq('name', updated.branch);
      if (activeCompanyId) branchQuery = branchQuery.eq('company_id', activeCompanyId);
      const { data: branchData } = await branchQuery.single();
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

  // Borrado TOTAL: elimina el perfil (cascada a roles/sucursales) y la cuenta de
  // auth. Requiere la service_role → se hace en la Edge Function admin-user-actions,
  // que valida que quien llama sea super admin o admin de la misma empresa.
  const deleteUser = async (userId: string) => {
    if (userId === appUser?.id) {
      throw new Error('No puedes eliminar tu propio usuario.');
    }
    const { data, error } = await supabase.functions.invoke('admin-user-actions', {
      body: { action: 'delete', userId },
    });
    if (error) throw new Error((data as any)?.error ?? error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    await load();
  };

  // Fija una contraseña nueva directamente (acción de admin), vía la Edge Function.
  const setPassword = async (userId: string, password: string) => {
    const { data, error } = await supabase.functions.invoke('admin-user-actions', {
      body: { action: 'set_password', userId, password },
    });
    if (error) throw new Error((data as any)?.error ?? error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
  };

  // Alternativa: enviar al usuario un correo para que él mismo restablezca su clave.
  const sendPasswordReset = async (email: string) => {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) throw error;
  };

  return (
    <UserContext.Provider value={{ users, addUser, updateUser, deleteUser, setPassword, sendPasswordReset, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUsers = (): UserContextType => {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUsers must be used within a UserProvider');
  return context;
};
