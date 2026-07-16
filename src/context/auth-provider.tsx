'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import type { User as AppUser } from '@/lib/types';
import { supabase, setReadOnlyMode } from '@/lib/supabase/client';
import { AppSkeleton } from '@/components/ui/app-skeleton';
import { CreateCompanyScreen } from '@/components/auth/create-company-screen';
import { BranchSelector } from '@/components/auth/branch-selector';
import { SuspendedScreen } from '@/components/auth/suspended-screen';
import { BranchInactiveScreen } from '@/components/auth/branch-inactive-screen';

interface AuthContextType {
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (name: string, email: string, pass: string, businessName: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  setImpersonatedCompany: (companyId: string | null, companyName: string | null) => void;
  setActiveBranch: (branchId: string, branchName: string) => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
// /mi-prestamo es el portal público de clientes finales (cédula + PIN, sin
// Supabase Auth de por medio) — debe quedar fuera del guard de sesión igual
// que /login.
const publicRoutes = ['/login', '/reset-password', '/mi-prestamo'];

function persistLocal(user: AppUser) {
  localStorage.setItem('userRole', user.role);
  localStorage.setItem('userBranch', user.branch);
  localStorage.setItem('userName', user.name);
  localStorage.setItem('userEmail', user.email);
  if (user.companyId) localStorage.setItem('userCompany', user.companyId);
  if (user.companyStatus) localStorage.setItem('userCompanyStatus', user.companyStatus);
  if (user.activeBranchId) localStorage.setItem('userBranchId', user.activeBranchId);
  if (user.impersonatedCompanyId) {
    localStorage.setItem('userImpersonatedCompany', user.impersonatedCompanyId);
    localStorage.setItem('userImpersonatedCompanyName', user.impersonatedCompanyName ?? '');
  }
}
function clearLocal() {
  ['userRole', 'userBranch', 'userName', 'userEmail', 'userCompany', 'userCompanyStatus', 'userBranchId', 'userImpersonatedCompany', 'userImpersonatedCompanyName'].forEach((k) => localStorage.removeItem(k));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [needsCompany, setNeedsCompany] = useState(false);
  const [needsBranchSelection, setNeedsBranchSelection] = useState(false);
  const [noActiveBranches, setNoActiveBranches] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadProfile = useCallback(async (userId: string, fallbackEmail?: string) => {
    // También traemos profile_branches y profile_roles para gerentes multi-sucursal
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id, name, email, role, is_super_admin, company_id,
        companies!profiles_company_id_fkey(status, demo_expires_at, trial_ends_at, paid_until, max_users),
        branches!profiles_branch_id_fkey(id, name, is_active),
        profile_branches(branches(id, name, is_active)),
        profile_roles(roles(id, name, description, permissions)),
        profile_companies(companies(id, name, status, is_demo))
      `)
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      // Sin perfil no hay app: cerrar la sesión (diferido, nunca en el flujo
      // de un callback de auth) para caer en /login, en vez de dejar el
      // skeleton infinito de `session && !appUser`.
      console.error('No se pudo cargar el perfil:', error?.message ?? 'perfil no encontrado');
      setAppUser(null);
      setTimeout(() => { supabase.auth.signOut(); }, 0);
      return;
    }

    if (data) {
      const companyList = ((data as any).profile_companies ?? [])
        .map((pc: any) => pc.companies)
        .filter(Boolean)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          isDemo: c.is_demo ?? false
        }));

      setNeedsCompany(!data.company_id && companyList.length === 0);
      
      // Construir la lista de sucursales a las que pertenece. Las sucursales
      // desactivadas se excluyen: no se pueden seleccionar ni operar desde ellas.
      const allBranches: {id: string, name: string, isActive: boolean}[] = [];
      const mainBranch = Array.isArray((data as any).branches) ? (data as any).branches[0] : (data as any).branches;
      if (mainBranch) allBranches.push({ id: mainBranch.id, name: mainBranch.name, isActive: mainBranch.is_active !== false });

      if (data.profile_branches && Array.isArray(data.profile_branches)) {
        data.profile_branches.forEach((pb: any) => {
          if (pb.branches && !allBranches.find(b => b.id === pb.branches.id)) {
            allBranches.push({ id: pb.branches.id, name: pb.branches.name, isActive: pb.branches.is_active !== false });
          }
        });
      }

      const branchList = allBranches.filter(b => b.isActive).map(b => ({ id: b.id, name: b.name }));

      // Tenía sucursal(es) asignadas pero TODAS están desactivadas: bloquear el
      // acceso (igual que una empresa suspendida), salvo super admin.
      setNoActiveBranches(allBranches.length > 0 && branchList.length === 0);

      const customRoles = (data.profile_roles ?? [])
        .map((pr: any) => pr.roles)
        .filter(Boolean)
        .map((r: any) => ({ id: r.id, name: r.name, description: r.description ?? '', permissions: r.permissions ?? {} }));

      const isManager = customRoles.some((r: any) => r.name.toLowerCase().includes('gerente'));
      const isAdminOrManager = !data.is_super_admin && (data.role === 'admin' || isManager);

      // Si ya había una sucursal activa seleccionada previamente en esta sesión, mantenerla
      const savedBranchId = localStorage.getItem('userBranchId');
      const savedImpersonatedId = localStorage.getItem('userImpersonatedCompany');
      const savedImpersonatedName = localStorage.getItem('userImpersonatedCompanyName');
      
      let activeBranch = branchList.length > 0 ? branchList[0] : { id: '', name: '' };
      let requireSelection = false;

      if (isAdminOrManager && branchList.length > 1) {
        const sessionSelected = sessionStorage.getItem('branchSelectedThisSession');
        if (sessionSelected !== 'true') {
          requireSelection = true;
        } else if (savedBranchId && branchList.find(b => b.id === savedBranchId)) {
          const found = branchList.find(b => b.id === savedBranchId);
          if (found) activeBranch = found;
        }
      } else {
        if (savedBranchId && branchList.find(b => b.id === savedBranchId)) {
          const found = branchList.find(b => b.id === savedBranchId);
          if (found) activeBranch = found;
        } else if (branchList.length > 1) {
          // Si no hay branch guardado y tiene más de 1, obligar a seleccionar
          requireSelection = true;
        }
      }

      setNeedsBranchSelection(requireSelection);

      const compStatus = (data as any).companies?.status;
      const demoExpiresAt = (data as any).companies?.demo_expires_at ?? undefined;
      const trialEndsAt = (data as any).companies?.trial_ends_at ?? undefined;
      const paidUntil = (data as any).companies?.paid_until ?? undefined;
      const maxUsers = (data as any).companies?.max_users ?? null;
      // Solo-lectura: puede entrar y ver, pero no modificar. Aplica si la prueba
      // venció, o si la suscripción pagada venció (paid_until en el pasado). El
      // super admin nunca queda en solo-lectura (gestiona/reactiva empresas).
      const trialExpired = compStatus === 'trial' && !!trialEndsAt && new Date(trialEndsAt).getTime() < Date.now();
      const subLapsed = compStatus === 'active' && !!paidUntil && new Date(paidUntil + 'T23:59:59').getTime() < Date.now();
      const isReadOnly = !data.is_super_admin && (trialExpired || subLapsed);
      // Activa/desactiva el bloqueo central de escrituras en el cliente Supabase.
      setReadOnlyMode(isReadOnly);

      const user: AppUser = {
        id: data.id,
        name: data.name ?? 'Usuario',
        email: data.email ?? fallbackEmail ?? '',
        role: data.is_super_admin ? 'admin' : (data.role as AppUser['role']),
        branch: activeBranch.name,
        activeBranchId: activeBranch.id,
        branches: branchList,
        companyId: data.company_id,
        companyStatus: compStatus,
        companyDemoExpiresAt: demoExpiresAt,
        companyTrialEndsAt: trialEndsAt,
        companyPaidUntil: paidUntil,
        isReadOnly,
        impersonatedCompanyId: savedImpersonatedId || undefined,
        impersonatedCompanyName: savedImpersonatedName || undefined,
        isSuperAdmin: !!data.is_super_admin,
        customRoles: customRoles,
        companies: companyList,
        companyMaxUsers: maxUsers,
      };
      setAppUser(user);
      if (!requireSelection) persistLocal(user);
    }
  }, []);

  useEffect(() => {
    let active = true;

    // onAuthStateChange emite INITIAL_SESSION al montar (con sesión o null),
    // así que cubre tanto la carga inicial como los cambios de sesión.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return;
      
      // Sesión "solo esta pestaña" reabierta en un contexto nuevo (el usuario
      // desmarcó "mantener sesión" y sessionStorage ya no existe): resolver el
      // estado de inmediato para que el efecto redirija a /login, y diferir el
      // signOut FUERA del callback — llamarlo dentro de onAuthStateChange
      // deadlockea el lock de auth de supabase-js (skeleton congelado).
      if (sess?.user) {
        const keepSession = localStorage.getItem('keepSession');
        const tabSession = sessionStorage.getItem('tabSession');
        if (keepSession === 'false' && tabSession !== 'true') {
          setSession(null);
          setAppUser(null);
          clearLocal();
          setLoading(false);
          setTimeout(() => { supabase.auth.signOut(); }, 0);
          return;
        }
      }

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
        setReadOnlyMode(false);
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
    if (!session && !isPublic) {
      router.replace('/login');
    } else if (session) {
      const hasMultipleCompanies = !!(appUser?.companies && appUser.companies.length > 1);
      const isImpersonating = !!appUser?.impersonatedCompanyId;
      const isClientRoute = !pathname.startsWith('/admin');

      if (isPublic) {
        if (appUser?.isSuperAdmin) {
          router.replace('/admin/companies');
        } else if (hasMultipleCompanies && !isImpersonating) {
          router.replace('/admin/empresas');
        } else {
          router.replace('/dashboard');
        }
      } else {
        if (appUser?.isSuperAdmin && !isImpersonating && isClientRoute) {
          router.replace('/admin/companies');
        } else if (hasMultipleCompanies && !isImpersonating && isClientRoute) {
          router.replace('/admin/empresas');
        }
      }
    }
  }, [session, loading, pathname, router, appUser]);

  const setImpersonatedCompany = useCallback(async (companyId: string | null, companyName: string | null) => {
    // Si no es super admin pero tiene múltiples compañías, actualizar su profiles.company_id en la base de datos
    if (appUser && !appUser.isSuperAdmin && appUser.companies && appUser.companies.length > 1) {
      let nextBranchId = null;
      if (companyId) {
        // Encontrar una sucursal por defecto para esa compañía
        const { data: branchData } = await supabase
          .from('branches')
          .select('id, name')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .limit(1);
        
        if (branchData && branchData[0]) {
          nextBranchId = branchData[0].id;
          localStorage.setItem('userBranchId', nextBranchId);
        } else {
          localStorage.removeItem('userBranchId');
        }
      } else {
        localStorage.removeItem('userBranchId');
      }

      // Actualizar la compañía y sucursal del perfil en la base de datos
      const { error } = await supabase
        .from('profiles')
        .update({ 
          company_id: companyId,
          branch_id: nextBranchId
        })
        .eq('id', appUser.id);

      if (error) {
        console.error('Error switching company:', error.message);
        return;
      }
    }

    setAppUser((prev) => {
      if (!prev) return null;
      const updated = { 
        ...prev, 
        impersonatedCompanyId: companyId ?? undefined, 
        impersonatedCompanyName: companyName ?? undefined 
      };
      if (!companyId) {
        localStorage.removeItem('userImpersonatedCompany');
        localStorage.removeItem('userImpersonatedCompanyName');
      }
      persistLocal(updated);
      return updated;
    });

    // Force a reload so all contexts/providers re-fetch data for the new company
    setTimeout(() => {
      if (companyId) {
        window.location.href = '/dashboard';
      } else {
        window.location.href = appUser?.isSuperAdmin ? '/admin/companies' : '/admin/empresas';
      }
    }, 100);
  }, [appUser]);

  const setActiveBranch = useCallback((branchId: string, branchName: string) => {
    setAppUser((prev) => {
      if (!prev) return null;
      const updated = { ...prev, activeBranchId: branchId, branch: branchName };
      persistLocal(updated);
      return updated;
    });
  }, []);

  const signIn = async (email: string, pass: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
  };

  const signUp = async (name: string, email: string, pass: string, businessName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pass,
      // Metadata consumida por el trigger handle_new_user: crea la empresa con
      // este nombre en plan Gratis (trial). El plan/estado ya no se envían: el
      // registro es siempre prueba gratis; el upgrade se maneja aparte.
      options: { data: { name, company_name: businessName } },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    clearLocal();
    localStorage.removeItem('keepSession');
    sessionStorage.removeItem('tabSession');
    sessionStorage.removeItem('branchSelectedThisSession');
    setAppUser(null);
    setSession(null);
    router.replace('/login');
  };

  const refreshProfile = useCallback(async () => {
    if (appUser?.id) {
      await loadProfile(appUser.id, appUser.email);
    }
  }, [appUser?.id, appUser?.email, loadProfile]);

  // Estado de carga / transición: mostrar el skeleton a pantalla completa.
  if (loading) return <AppSkeleton message="Cargando plataforma..." />;
  const isPublic = publicRoutes.includes(pathname);
  if (session && !appUser) return <AppSkeleton message="Cargando datos..." />;   // sesión activa, cargando perfil
  if (!session && !isPublic) return <AppSkeleton message="Cargando plataforma..." />;  // sin sesión, redirigiendo a login
  // Sesión activa pero seguimos en una ruta pública (login/reset-password): ya
  // se disparó el redirect a /dashboard pero el pathname todavía no lo refleja.
  // Sin este caso, aquí abajo se hace fallthrough a `children` y el formulario
  // de login remonta de golpe (con su estado en blanco) justo antes de que la
  // navegación termine — se ve como un parpadeo de vuelta al login.
  if (session && isPublic) return <AppSkeleton message="Entrando..." />;

  // Cuenta autenticada pero sin empresa: onboarding obligatorio antes de la app.
  if (session && appUser && needsCompany && !isPublic) {
    return <CreateCompanyScreen userName={appUser.name} onSignOut={signOut} />;
  }

  // Cuenta suspendida o pendiente de activación
  if (session && appUser && appUser.companyStatus === 'suspended' && !appUser.isSuperAdmin && !isPublic) {
    return <SuspendedScreen userName={appUser.name} onSignOut={signOut} />;
  }

  // Todas las sucursales del usuario están desactivadas: no puede operar.
  if (session && appUser && noActiveBranches && !appUser.isSuperAdmin && !isPublic) {
    return <BranchInactiveScreen userName={appUser.name} onSignOut={signOut} />;
  }

  // Cuenta autenticada con múltiples sucursales, pero sin seleccionar una aún
  if (session && appUser && needsBranchSelection && !isPublic) {
    return (
      <BranchSelector
        userName={appUser.name}
        branches={appUser.branches || []}
        onSelect={(id, name) => {
          sessionStorage.setItem('branchSelectedThisSession', 'true');
          setActiveBranch(id, name);
          setNeedsBranchSelection(false);
          // Si es superAdmin (y por alguna razón entró acá), ir a plataforma.
          if (appUser?.isSuperAdmin) {
            router.replace('/admin/companies');
          } else {
            router.replace('/dashboard');
          }
        }}
        onSignOut={signOut}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ appUser, loading, signIn, signUp, signOut, setImpersonatedCompany, setActiveBranch, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
