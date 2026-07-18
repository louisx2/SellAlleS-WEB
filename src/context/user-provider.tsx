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

  // Alta de empleado vía Edge Function (service_role): un signUp público +
  // upsert desde el cliente se quedaba pegado para siempre, porque la fila
  // barebones que deja handle_new_user() tiene company_id NULL, y la política
  // RLS de UPDATE sobre profiles exige que la fila YA pertenezca a la empresa
  // de quien llama — nunca se puede asignar una empresa por primera vez así.
  // Además evitaba depender del endpoint público de signup (correo de
  // confirmación sujeto al rate-limit de Supabase).
  const addUser = async (newUser: Omit<AppUser, 'id'>, password?: string) => {
    if (!activeCompanyId) throw new Error('No hay una empresa activa seleccionada.');
    if (!password) throw new Error('Contraseña requerida.');

    let branchId = newUser.activeBranchId;
    if (!branchId && newUser.branch) {
      let branchQuery = supabase.from('branches').select('id').eq('name', newUser.branch);
      if (activeCompanyId) branchQuery = branchQuery.eq('company_id', activeCompanyId);
      const { data: branchData } = await branchQuery.single();
      if (branchData) branchId = branchData.id;
    }

    const { data, error } = await supabase.functions.invoke('admin-user-actions', {
      body: {
        action: 'create',
        companyId: activeCompanyId,
        name: newUser.name.trim(),
        email: newUser.email.trim(),
        password,
        role: newUser.role,
        branchId: branchId || null,
        branchIds: (newUser.branches ?? []).map((b) => b.id),
        roleIds: (newUser.customRoles ?? []).map((r) => r.id),
      },
    });
    if (error) throw new Error((data as any)?.error ?? error.message);
    if ((data as any)?.error) throw new Error((data as any).error);

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

    const isManagerRole = updated.role === 'manager';
    const dbRole = isManagerRole ? 'cashier' : updated.role;

    const updatePayload: any = {
      name: updated.name,
      role: dbRole,
    };
    
    if (branchId) {
      updatePayload.branch_id = branchId;
    }

    // Fuente de verdad del rol: la membresía perfil↔empresa de la empresa
    // activa. El trigger de lockout impide dejar la empresa sin admin.
    if (activeCompanyId) {
      const { error: pcError } = await supabase
        .from('profile_companies')
        .upsert(
          { profile_id: updated.id, company_id: activeCompanyId, role: dbRole },
          { onConflict: 'profile_id,company_id' }
        );
      if (pcError) throw pcError;
    }

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', updated.id);

    if (error) throw error;

    // Update custom roles if provided
    if (updated.customRoles) {
      const finalCustomRoles = [...updated.customRoles];

      // Si el rol es gerente, buscar y adjuntar el rol personalizado de Gerente si no existe
      if (isManagerRole) {
        const { data: gerenteRole } = await supabase
          .from('roles')
          .select('id')
          .eq('company_id', activeCompanyId)
          .ilike('name', '%gerente%')
          .maybeSingle();

        if (gerenteRole && !finalCustomRoles.some(r => r.id === gerenteRole.id)) {
          finalCustomRoles.push({ id: gerenteRole.id, name: 'Gerente', description: '' });
        }
      }

      // Borrar SOLO los roles de la empresa activa: el perfil puede tener
      // roles personalizados de sus otras empresas y no hay que tocárselos.
      const { data: companyRoles } = await supabase
        .from('roles')
        .select('id')
        .eq('company_id', activeCompanyId);
      const companyRoleIds = (companyRoles ?? []).map(r => r.id);
      if (companyRoleIds.length > 0) {
        await supabase.from('profile_roles').delete().eq('profile_id', updated.id).in('role_id', companyRoleIds);
      }

      // Insertar nuevos (la UI solo lista roles de la empresa activa)
      const insertData = finalCustomRoles
        .filter(role => companyRoleIds.includes(role.id))
        .map(role => ({
          profile_id: updated.id,
          role_id: role.id
        }));
      if (insertData.length > 0) {
        const { error: prError } = await supabase.from('profile_roles').insert(insertData);
        if (prError) throw prError;
      }
    }

    // Update profile branches if provided
    if (updated.branches) {
      // Borrar sucursales anteriores SOLO de la empresa activa (las de sus
      // otras empresas no se tocan)
      await supabase.from('profile_branches').delete().eq('profile_id', updated.id).eq('company_id', activeCompanyId);

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
