'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import type { User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/auth-provider';
import { createClient } from '@supabase/supabase-js';

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
      .select(`
        id, name, email, role, is_super_admin, branch_id, email_confirmed_at,
        branches!profiles_branch_id_fkey(id, name),
        profile_roles(roles(id, name, description)),
        profile_branches(branches(id, name, is_active))
      `)
      .eq('company_id', activeCompanyId);
    if (!error && data) {
      setUsers(
        data.map((d: any) => {
          const assignedBranches = (d.profile_branches ?? [])
            .map((pb: any) => pb.branches)
            .filter(Boolean)
            .map((b: any) => ({ id: b.id, name: b.name }));

          return {
            id: d.id,
            name: d.name ?? 'Usuario',
            email: d.email ?? '',
            role: d.is_super_admin ? 'admin' : d.role,
            branch: d.branches?.name ?? '',
            activeBranchId: d.branch_id,
            branches: assignedBranches,
            customRoles: (d.profile_roles ?? [])
              .map((pr: any) => pr.roles)
              .filter(Boolean)
              .map((r: any) => ({ id: r.id, name: r.name, description: r.description ?? '' })),
            emailConfirmedAt: d.email_confirmed_at
          };
        })
      );
    }
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const addUser = async (newUser: Omit<AppUser, 'id'>, password?: string) => {
    if (!activeCompanyId) throw new Error('No hay una empresa activa seleccionada.');
    if (!password) throw new Error('Contraseña requerida.');

    // 1. Crear un cliente temporal de Supabase sin persistencia de sesión
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    const tempClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

    // 2. Registrar el usuario en auth.users
    const { data: authData, error: authError } = await tempClient.auth.signUp({
      email: newUser.email.trim(),
      password: password,
      options: { data: { name: newUser.name.trim() } }
    });

    if (authError) throw authError;

    if (authData.user) {
      // 3. Crear el perfil en public.profiles
      let branchId = newUser.activeBranchId;
      if (!branchId && newUser.branch) {
        let branchQuery = supabase.from('branches').select('id').eq('name', newUser.branch);
        if (activeCompanyId) branchQuery = branchQuery.eq('company_id', activeCompanyId);
        const { data: branchData } = await branchQuery.single();
        if (branchData) branchId = branchData.id;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: newUser.email.trim(),
          name: newUser.name.trim(),
          role: newUser.role,
          company_id: activeCompanyId,
          branch_id: branchId || null,
          email_confirmed_at: authData.user.email_confirmed_at || null,
        });

      if (profileError) throw profileError;

      // 4. Guardar las sucursales asignadas en profile_branches
      if (newUser.branches && newUser.branches.length > 0) {
        const branchInserts = newUser.branches.map(b => ({
          profile_id: authData.user!.id,
          branch_id: b.id,
          company_id: activeCompanyId
        }));
        const { error: pbError } = await supabase.from('profile_branches').insert(branchInserts);
        if (pbError) throw pbError;
      }

      // 5. Guardar los roles personalizados
      if (newUser.customRoles && newUser.customRoles.length > 0) {
        const roleInserts = newUser.customRoles.map(role => ({
          profile_id: authData.user!.id,
          role_id: role.id
        }));
        const { error: prError } = await supabase.from('profile_roles').insert(roleInserts);
        if (prError) throw prError;
      }
    }

    await load();
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

    // Update profile branches if provided
    if (updated.branches) {
      // Borrar sucursales anteriores
      await supabase.from('profile_branches').delete().eq('profile_id', updated.id);

      // Insertar nuevas
      if (updated.branches.length > 0) {
        const insertData = updated.branches.map(b => ({
          profile_id: updated.id,
          branch_id: b.id,
          company_id: activeCompanyId
        }));
        await supabase.from('profile_branches').insert(insertData);
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
