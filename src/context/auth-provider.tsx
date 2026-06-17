'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import type { User as AppUser } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import { AppSkeleton } from '@/components/ui/app-skeleton';

interface AuthContextType {
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (name: string, email: string, pass: string) => Promise<{ needsConfirmation: boolean }>;
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
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadProfile = useCallback(async (userId: string, fallbackEmail?: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, role, is_super_admin, branches(name)')
      .eq('id', userId)
      .maybeSingle();

    if (data) {
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

  const signUp = async (name: string, email: string, pass: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: { data: { name } },
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
