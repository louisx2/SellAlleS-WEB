'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import type { User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { AppSkeleton } from '@/components/ui/app-skeleton';
import { CreateCompanyScreen } from '@/components/auth/create-company-screen';

interface AuthContextType {
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (name: string, email: string, pass: string, businessName: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const publicRoutes = ['/login'];

// Varios componentes (carrito, ventas, pagos) leen estos valores de localStorage.
function persistLocal(user: AppUser) {
  localStorage.setItem('userRole', user.role);
  localStorage.setItem('userBranch', user.branch);
  localStorage.setItem('userName', user.name);
  localStorage.setItem('userEmail', user.email);
}
function clearLocal() {
  ['userRole', 'userBranch', 'userName', 'userEmail'].forEach((k) => localStorage.removeItem(k));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [needsCompany, setNeedsCompany] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadProfile = useCallback(async (userId: string, fallbackEmail?: string) => {
    const { data } = await supabase
      .from('profiles')
      // branches! desambiguado: profiles se relaciona con branches por branch_id
      // y también vía profile_branches; sin esto PostgREST devuelve PGRST201.
      .select('id, name, email, role, is_super_admin, company_id, branches!profiles_branch_id_fkey(name)')
      .eq('id', userId)
      .maybeSingle();

    if (data) {
      // Perfil sin empresa (registro sin nombre de negocio o cuenta antigua):
      // se muestra la pantalla de creación de empresa en vez de la app.
      setNeedsCompany(!data.company_id);
      const branchName = Array.isArray((data as any).branches)
        ? (data as any).branches[0]?.name
        : (data as any).branches?.name;
      const user: AppUser = {
        id: data.id,
        name: data.name ?? 'Usuario',
        email: data.email ?? fallbackEmail ?? '',
        role: data.is_super_admin ? 'admin' : (data.role as AppUser['role']),
        branch: branchName ?? '',
        isSuperAdmin: !!data.is_super_admin,
      };
      setAppUser(user);
      persistLocal(user);
    } else {
      setAppUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    // onAuthStateChange emite INITIAL_SESSION al montar (con sesión o null),
    // así que cubre tanto la carga inicial como los cambios de sesión.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return;
      setSession(sess);
      if (sess?.user) {
        // Diferir la consulta a la BD fuera del callback de auth (recomendado por Supabase).
        const uid = sess.user.id;
        const mail = sess.user.email ?? undefined;
        setTimeout(() => {
          if (!active) return;
          loadProfile(uid, mail).finally(() => { if (active) setLoading(false); });
        }, 0);
      } else {
        setAppUser(null);
        clearLocal();
        setLoading(false);
      }
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  // Redirección basada en la SESIÓN (no en el perfil), para no rebotar al /login
  // mientras carga el perfil.
  useEffect(() => {
    if (loading) return;
    const isPublic = publicRoutes.includes(pathname);
    if (!session && !isPublic) router.replace('/login');
    else if (session && isPublic) router.replace('/dashboard');
  }, [session, loading, pathname, router]);

  const signIn = async (email: string, pass: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
  };

  const signUp = async (name: string, email: string, pass: string, businessName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pass,
      // company_name lo consume el trigger handle_new_user: crea la empresa,
      // la sucursal Principal y la suscripción al plan Gratis.
      options: { data: { name, company_name: businessName } },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    clearLocal();
    setAppUser(null);
    setSession(null);
    router.replace('/login');
  };

  // Estado de carga / transición: mostrar el skeleton a pantalla completa.
  if (loading) return <AppSkeleton />;
  const isPublic = publicRoutes.includes(pathname);
  if (session && !appUser) return <AppSkeleton />;   // sesión activa, cargando perfil
  if (!session && !isPublic) return <AppSkeleton />;  // sin sesión, redirigiendo a login

  // Cuenta autenticada pero sin empresa: onboarding obligatorio antes de la app.
  if (session && appUser && needsCompany && !isPublic) {
    return <CreateCompanyScreen userName={appUser.name} onSignOut={signOut} />;
  }

  return (
    <AuthContext.Provider value={{ appUser, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
