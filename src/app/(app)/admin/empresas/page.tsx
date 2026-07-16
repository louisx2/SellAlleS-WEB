'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PlusCircle, ArrowRight, ArrowLeft } from 'lucide-react';
import { CompanyModulesDialog } from '@/components/admin/company-modules-dialog';
import { CompaniesDataTable } from '@/components/admin/companies-data-table';
import { DeleteConfirmDialog } from '@/components/admin/delete-confirm-dialog';
import { ManageCompanyUsersDialog } from '@/components/admin/manage-company-users-dialog';
import { SubscriptionPaymentsDialog } from '@/components/admin/subscription-payments-dialog';
import { CompanyRolesDialog } from '@/components/admin/company-roles-dialog';
import { createClient } from '@supabase/supabase-js';
import type { Company } from '@/lib/types';
import { BUSINESS_TYPE_PRESETS, OPTIONAL_VERTICALS, type BusinessType } from '@/lib/business-types';

interface Plan { id: string; name: string; price: number; max_users?: number; monthly_price?: number | null; annual_price_per_month?: number | null; }
interface Sub { id: string; company_id: string; plan_id: string | null; custom_monthly_price?: number | null; }

const NONE = 'none';
const CUSTOM_PLAN_NAME = 'A medida';

const emptyForm = {
  name: '', rnc: '', phone: '', address: '',
  status: 'trial' as Company['status'], planId: NONE,
  isFormalized: false, ncfEnabled: false, isDemo: false,
  adminName: '', adminEmail: '', adminPassword: '',
  adminConfirmPassword: '',
  businessType: 'tienda' as BusinessType,
  customBusinessType: '',
  maxUsers: 2,
  customMonthlyPrice: '',
};

export default function CompaniesManagementPage() {
  const { appUser, setImpersonatedCompany, setActiveBranch } = useAuth();
  const { toast } = useToast();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  interface ExtraUser { name: string; email: string; password: string; confirmPassword: string; role: 'admin' | 'cashier'; }
  const [extraUsers, setExtraUsers] = useState<ExtraUser[]>([]);

  const handlePlanChange = (v: string) => {
    const selectedPlan = plans.find(p => p.id === v);
    let defaultMaxUsers = 2;
    if (v === NONE) {
      defaultMaxUsers = 2;
    } else if (selectedPlan) {
      defaultMaxUsers = selectedPlan.max_users ?? 999999;
    }
    setForm({ ...form, planId: v, maxUsers: defaultMaxUsers });
  };

  const [modulesFor, setModulesFor] = useState<Company | null>(null);
  const [editingBranch, setEditingBranch] = useState<{ id: string; name: string; location: string; companyId: string } | null>(null);
  const [statusTarget, setStatusTarget] = useState<Company | null>(null);
  const [deleteCompanyTarget, setDeleteCompanyTarget] = useState<Company | null>(null);
  const [deleteBranchTarget, setDeleteBranchTarget] = useState<{ id: string; name: string; companyId: string } | null>(null);
  const [addBranchFor, setAddBranchFor] = useState<Company | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchLocation, setNewBranchLocation] = useState('');
  const [manageUsersFor, setManageUsersFor] = useState<Company | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Company | null>(null);
  const [rolesFor, setRolesFor] = useState<Company | null>(null);
  const [branchStatusTarget, setBranchStatusTarget] = useState<{ id: string; name: string; isActive: boolean } | null>(null);
  // Compartir entre sucursales (por módulo). Default OFF: cada sucursal aislada.
  const [sharing, setSharing] = useState({ clientes: false, credito: false, financiamiento: false, prestamos: false });

  const load = useCallback(async () => {
    const compsQuery = appUser?.isSuperAdmin
      ? supabase.from('companies').select('*, branches(id, name, location, is_active)').order('created_at', { ascending: false })
      : supabase.from('companies').select('*, branches(id, name, location, is_active)').in('id', appUser?.companies?.map((c) => c.id) || []).order('created_at', { ascending: false });

    const [
      { data: comps },
      { data: pls },
      { data: ss },
    ] = await Promise.all([
      compsQuery,
      supabase.from('plans').select('id, name, price, max_users, monthly_price, annual_price_per_month').order('sort_order'),
      supabase.from('subscriptions').select('id, company_id, plan_id, custom_monthly_price'),
    ]);

    if (comps) setCompanies(comps as Company[]);
    if (pls) setPlans(pls as Plan[]);
    if (ss) {
      const map: Record<string, Sub> = {};
      (ss as Sub[]).forEach((s) => { map[s.company_id] = s; });
      setSubs(map);
    }
    setLoading(false);
  }, []);

  const hasMultipleCompanies = !!(appUser?.companies && appUser.companies.length > 1);

  useEffect(() => { if (appUser?.isSuperAdmin || hasMultipleCompanies) load(); }, [appUser, load, hasMultipleCompanies]);

  const canAccess = appUser?.isSuperAdmin || hasMultipleCompanies;
  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Empresas" />
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No tienes permiso para ver esta sección.
        </CardContent></Card>
      </div>
    );
  }

  const getPlanName = (companyId: string) => {
    const sub = subs[companyId];
    if (!sub?.plan_id) return '—';
    return plans.find((p) => p.id === sub.plan_id)?.name ?? '—';
  };

  const getPlanRates = (companyId: string) => {
    const sub = subs[companyId];
    const plan = plans.find((p) => p.id === sub?.plan_id);
    return {
      monthlyPrice: plan?.monthly_price ?? null,
      annualPricePerMonth: plan?.annual_price_per_month ?? null,
      customMonthlyPrice: sub?.custom_monthly_price ?? null,
    };
  };

  const openCreate = () => {
    setEditingId(null); setStep(1); setForm(emptyForm);
    setExtraUsers([]);
    setSharing({ clientes: false, credito: false, financiamiento: false, prestamos: false });
    setOpen(true);
  };
  const openEdit = (c: Company) => {
    setEditingId(c.id);
    setStep(1);
    const isPreset = c.business_type ? (c.business_type in BUSINESS_TYPE_PRESETS) : false;
    setForm({
      name: c.name, rnc: c.rnc ?? '', phone: c.phone ?? '', address: c.address ?? '',
      status: c.status, planId: subs[c.id]?.plan_id ?? NONE,
      isFormalized: c.is_formalized, ncfEnabled: c.ncf_enabled, isDemo: c.is_demo ?? false,
      adminName: '', adminEmail: '', adminPassword: '',
      adminConfirmPassword: '',
      businessType: isPreset ? (c.business_type as BusinessType) : 'otro',
      customBusinessType: isPreset ? '' : (c.business_type ?? ''),
      maxUsers: c.max_users ?? 2,
      customMonthlyPrice: subs[c.id]?.custom_monthly_price != null ? String(subs[c.id].custom_monthly_price) : '',
    });
    setExtraUsers([]);
    // Cargar la config de compartir entre sucursales de esta empresa.
    setSharing({ clientes: false, credito: false, financiamiento: false, prestamos: false });
    supabase
      .from('company_branch_sharing')
      .select('scope, enabled')
      .eq('company_id', c.id)
      .then(({ data }) => {
        if (data) {
          setSharing({
            clientes: data.find((r) => r.scope === 'clientes')?.enabled ?? false,
            credito: data.find((r) => r.scope === 'credito')?.enabled ?? false,
            financiamiento: data.find((r) => r.scope === 'financiamiento')?.enabled ?? false,
            prestamos: data.find((r) => r.scope === 'prestamos')?.enabled ?? false,
          });
        }
      });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Falta el nombre', description: 'Escribe el nombre de la empresa.', variant: 'destructive' });
      return;
    }

    if (!editingId && step === 1) {
      if (form.businessType === 'otro' && !form.customBusinessType.trim()) {
        toast({ title: 'Especificar sector', description: 'Por favor, escribe a qué se dedica el negocio.', variant: 'destructive' });
        return;
      }
      setStep(2);
      return;
    }

    if (!editingId && step === 2) {
      if (!form.adminName.trim() || !form.adminEmail.trim() || !form.adminPassword.trim()) {
        toast({ title: 'Datos incompletos', description: 'Por favor completa todos los campos del administrador.', variant: 'destructive' });
        return;
      }
      if (form.adminPassword.length < 8) {
        toast({ title: 'Contraseña débil', description: 'La contraseña del administrador debe tener al menos 8 caracteres.', variant: 'destructive' });
        return;
      }
      if (!/[A-Z]/.test(form.adminPassword)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña del administrador debe incluir al menos una letra mayúscula.', variant: 'destructive' });
        return;
      }
      if (!/[a-z]/.test(form.adminPassword)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña del administrador debe incluir al menos una letra minúscula.', variant: 'destructive' });
        return;
      }
      if (!/\d/.test(form.adminPassword)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña del administrador debe incluir al menos un número.', variant: 'destructive' });
        return;
      }
      if (!/[@$!%*?&._\-\/#]/.test(form.adminPassword)) {
        toast({ title: 'Contraseña débil', description: 'La contraseña del administrador debe incluir al menos un carácter especial (ej: @$!%*?&._-/#).', variant: 'destructive' });
        return;
      }
      if (form.adminPassword !== form.adminConfirmPassword) {
        toast({ title: 'Contraseñas no coinciden', description: 'Las contraseñas del administrador no coinciden.', variant: 'destructive' });
        return;
      }

      setSaving(true);
      try {
        const { data: existingUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', form.adminEmail.trim())
          .maybeSingle();

        if (existingUser) {
          toast({ title: 'Correo en uso', description: 'El correo electrónico del administrador ya está registrado.', variant: 'destructive' });
          setSaving(false);
          return;
        }
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }

      setStep(3);
      return;
    }

    if (!editingId && step === 3) {
      for (const u of extraUsers) {
        if (!u.name.trim() || !u.email.trim() || !u.password.trim()) {
          toast({ title: 'Datos incompletos', description: `Por favor completa todos los campos del usuario ${u.email || u.name}.`, variant: 'destructive' });
          return;
        }
        if (u.password.length < 8) {
          toast({ title: 'Contraseña débil', description: `La contraseña para ${u.email} debe tener al menos 8 caracteres.`, variant: 'destructive' });
          return;
        }
        if (!/[A-Z]/.test(u.password)) {
          toast({ title: 'Contraseña débil', description: `La contraseña para ${u.email} debe incluir al menos una letra mayúscula.`, variant: 'destructive' });
          return;
        }
        if (!/[a-z]/.test(u.password)) {
          toast({ title: 'Contraseña débil', description: `La contraseña para ${u.email} debe incluir al menos una letra minúscula.`, variant: 'destructive' });
          return;
        }
        if (!/\d/.test(u.password)) {
          toast({ title: 'Contraseña débil', description: `La contraseña para ${u.email} debe incluir al menos un número.`, variant: 'destructive' });
          return;
        }
        if (!/[@$!%*?&._\-\/#]/.test(u.password)) {
          toast({ title: 'Contraseña débil', description: `La contraseña para ${u.email} debe incluir al menos un carácter especial (ej: @$!%*?&._-/#).`, variant: 'destructive' });
          return;
        }
        if (u.password !== u.confirmPassword) {
          toast({ title: 'Contraseñas no coinciden', description: `Las contraseñas para ${u.email} no coinciden.`, variant: 'destructive' });
          return;
        }

        const { data: existingUser } = await supabase.from('profiles').select('id').eq('email', u.email.trim()).maybeSingle();
        if (existingUser) {
          toast({ title: 'Correo en uso', description: `El correo ${u.email} ya está registrado en la plataforma.`, variant: 'destructive' });
          return;
        }
      }

      const totalNewUsers = 1 + extraUsers.length;
      const maxUsersLimit = form.maxUsers;
      if (maxUsersLimit !== null && totalNewUsers > maxUsersLimit) {
        toast({ title: 'Límite superado', description: `No puedes crear ${totalNewUsers} usuarios. El límite de la empresa es de ${maxUsersLimit} usuarios.`, variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        rnc: form.rnc.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        status: form.status,
        is_formalized: form.isFormalized,
        ncf_enabled: form.ncfEnabled,
        is_demo: form.isDemo,
        business_type: form.businessType === 'otro' ? form.customBusinessType.trim() : form.businessType,
        max_users: form.maxUsers,
      };

      let companyId = editingId;
      if (editingId) {
        const { error } = await supabase.from('companies').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('companies').insert(payload).select().single();
        if (error) throw error;
        companyId = data.id;
      }

      if (editingId) {
        const { error: sharingError } = await supabase
          .from('company_branch_sharing')
          .upsert(
            [
              { company_id: editingId, scope: 'clientes', enabled: sharing.clientes },
              { company_id: editingId, scope: 'credito', enabled: sharing.credito },
              { company_id: editingId, scope: 'financiamiento', enabled: sharing.financiamiento },
              { company_id: editingId, scope: 'prestamos', enabled: sharing.prestamos },
            ],
            { onConflict: 'company_id,scope' },
          );
        if (sharingError) throw sharingError;
      }

      if (companyId && form.planId !== NONE) {
        const selectedPlanName = plans.find((p) => p.id === form.planId)?.name;
        const customMonthlyPrice = selectedPlanName === CUSTOM_PLAN_NAME && form.customMonthlyPrice.trim()
          ? Number(form.customMonthlyPrice)
          : null;
        const existing = subs[companyId];
        if (existing) {
          await supabase.from('subscriptions').update({ plan_id: form.planId, custom_monthly_price: customMonthlyPrice }).eq('id', existing.id);
        } else {
          await supabase.from('subscriptions').insert({ company_id: companyId, plan_id: form.planId, status: 'active', custom_monthly_price: customMonthlyPrice });
        }
      }

      if (!editingId && companyId) {
        const { data: branchData, error: branchError } = await supabase
          .from('branches')
          .insert({
            name: 'Principal',
            location: form.address.trim() || 'Principal',
            company_id: companyId,
          })
          .select()
          .single();

        if (branchError) throw branchError;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
        const tempClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

        const { data: authData, error: authError } = await tempClient.auth.signUp({
          email: form.adminEmail.trim(),
          password: form.adminPassword,
          options: { data: { name: form.adminName.trim() } }
        });

        if (authError) throw authError;

        if (authData.user) {
          // upsert, no insert: el trigger handle_new_user ya crea una fila
          // barebones en profiles apenas se registra el auth.user.
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: authData.user.id,
              email: form.adminEmail.trim(),
              name: form.adminName.trim(),
              role: 'admin',
              company_id: companyId,
              branch_id: branchData.id,
              email_confirmed_at: authData.user.email_confirmed_at || null,
            });

          if (profileError) throw profileError;

          await supabase
            .from('profile_branches')
            .insert({ profile_id: authData.user.id, branch_id: branchData.id });
        }

        for (const u of extraUsers) {
          const { data: extAuthData, error: extAuthError } = await tempClient.auth.signUp({
            email: u.email.trim(),
            password: u.password,
            options: { data: { name: u.name.trim() } }
          });

          if (extAuthError) throw extAuthError;

          if (extAuthData.user) {
            const { error: extProfileError } = await supabase
              .from('profiles')
              .upsert({
                id: extAuthData.user.id,
                email: u.email.trim(),
                name: u.name.trim(),
                role: u.role,
                company_id: companyId,
                branch_id: branchData.id,
                email_confirmed_at: extAuthData.user.email_confirmed_at || null,
              });

            if (extProfileError) throw extProfileError;

            await supabase
              .from('profile_branches')
              .insert({ profile_id: extAuthData.user.id, branch_id: branchData.id });
          }
        }

        // Preset por tipo de negocio: enciende/apaga los módulos verticales
        // (servicios/lavandería/préstamos) y siembra categorías/tipos de
        // servicio por defecto. Los módulos "núcleo" no se tocan.
        const preset = BUSINESS_TYPE_PRESETS[form.businessType];
        const optionalRows = OPTIONAL_VERTICALS.map((key) => ({
          company_id: companyId, module_key: key, enabled: preset.modules.includes(key),
        }));
        await supabase.from('company_modules').upsert(optionalRows, { onConflict: 'company_id,module_key' });

        if (preset.productCategories?.length) {
          await supabase.from('product_categories').insert(
            preset.productCategories.map((name) => ({ name, company_id: companyId })),
          );
        }
        if (preset.serviceTypes?.length) {
          await supabase.from('service_types').insert(
            preset.serviceTypes.map((st) => ({ name: st.name, base_price: st.basePrice ?? 0, company_id: companyId })),
          );
        }
      }

      toast({ title: editingId ? 'Empresa actualizada' : 'Empresa creada con su administrador', description: form.name });
      setOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo guardar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranch = async () => {
    if (!editingBranch || !editingBranch.name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('branches')
        .update({ name: editingBranch.name.trim(), location: editingBranch.location.trim() || null })
        .eq('id', editingBranch.id);
      if (error) throw error;
      toast({ title: 'Sucursal actualizada' });
      setEditingBranch(null);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!statusTarget) return;
    const nextStatus: Company['status'] = statusTarget.status === 'suspended' ? 'active' : 'suspended';
    setSaving(true);
    try {
      const { error } = await supabase.from('companies').update({ status: nextStatus }).eq('id', statusTarget.id);
      if (error) throw error;
      toast({
        title: nextStatus === 'suspended' ? 'Empresa desactivada' : 'Empresa reactivada',
        description: statusTarget.name,
      });
      setStatusTarget(null);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo cambiar el estado.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Borra la empresa y TODO su historial (ventas, clientes, financiamientos,
  // usuarios...) vía RPC. Los perfiles borrados por SQL dejan cuentas de auth
  // huérfanas, así que se purgan aparte con la Edge Function admin-user-actions.
  const handleDeleteCompany = async () => {
    if (!deleteCompanyTarget) return;
    const { data: profileIds, error } = await supabase.rpc('delete_company_cascade', {
      p_company_id: deleteCompanyTarget.id,
    });
    if (error) { toast({ title: 'No se pudo eliminar', description: error.message, variant: 'destructive' }); return; }
    if (Array.isArray(profileIds) && profileIds.length > 0) {
      await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'purge_users', userIds: profileIds },
      });
    }
    toast({ title: 'Empresa eliminada', description: deleteCompanyTarget.name });
    setDeleteCompanyTarget(null);
    await load();
  };

  // Borra la sucursal y su historial operativo; usuarios y clientes quedan
  // desvinculados (no se borran). Bloqueada si es la única sucursal (RPC lo valida).
  const handleDeleteBranch = async () => {
    if (!deleteBranchTarget) return;
    const { error } = await supabase.rpc('delete_branch_cascade', { p_branch_id: deleteBranchTarget.id });
    if (error) { toast({ title: 'No se pudo eliminar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Sucursal eliminada', description: deleteBranchTarget.name });
    setDeleteBranchTarget(null);
    await load();
  };

  // Crea una sucursal para una empresa arbitraria sin necesidad de impersonarla:
  // se fija company_id explícito (current_company_id() no sirve aquí porque el
  // super admin no está necesariamente "dentro" de esa empresa).
  const handleAddBranch = async () => {
    if (!addBranchFor || !newBranchName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('branches').insert({
        company_id: addBranchFor.id,
        name: newBranchName.trim(),
        location: newBranchLocation.trim() || null,
      });
      if (error) throw error;
      toast({ title: 'Sucursal creada', description: `${newBranchName} en ${addBranchFor.name}` });
      setAddBranchFor(null);
      setNewBranchName('');
      setNewBranchLocation('');
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo crear la sucursal.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Desactivar bloquea el acceso a los usuarios de esa sucursal (ver auth-provider);
  // no borra nada, es reversible. Requiere is_super_admin() por la RLS de branches.
  const handleToggleBranchStatus = async () => {
    if (!branchStatusTarget) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: !branchStatusTarget.isActive })
        .eq('id', branchStatusTarget.id);
      if (error) throw error;
      toast({
        title: branchStatusTarget.isActive ? 'Sucursal desactivada' : 'Sucursal reactivada',
        description: branchStatusTarget.name,
      });
      setBranchStatusTarget(null);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo cambiar el estado.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {appUser?.isSuperAdmin ? 'Empresas' : 'Mis Empresas'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {appUser?.isSuperAdmin 
              ? 'Administra todas las empresas registradas, sus sucursales y su estado.' 
              : 'Administra tus empresas registradas y sus sucursales.'}
          </p>
        </div>
        {appUser?.isSuperAdmin && (
          <Button onClick={openCreate} className="w-full sm:w-auto shadow-sm">
            <PlusCircle className="mr-2 h-4 w-4" />
            Nueva empresa
          </Button>
        )}
      </div>

      <CompaniesDataTable
        companies={companies}
        loading={loading}
        onEditCompany={openEdit}
        onModulesCompany={setModulesFor}
        onToggleStatus={setStatusTarget}
        onEnterCompany={(c) => setImpersonatedCompany(c.id, c.name)}
        onEnterBranch={(cId, cName, bId, bName) => {
          setActiveBranch(bId, bName);
          setImpersonatedCompany(cId, cName);
        }}
        onEditBranch={setEditingBranch}
        onDeleteCompany={setDeleteCompanyTarget}
        onDeleteBranch={setDeleteBranchTarget}
        onAddBranch={(c) => { setAddBranchFor(c); setNewBranchName(''); setNewBranchLocation(''); }}
        onManageUsers={setManageUsersFor}
        onManagePayments={setPaymentsFor}
        onManageRoles={setRolesFor}
        onToggleBranchStatus={setBranchStatusTarget}
        getPlanName={getPlanName}
      />

      <SubscriptionPaymentsDialog
        company={paymentsFor}
        defaultPlanName={paymentsFor ? getPlanName(paymentsFor.id) : undefined}
        planRates={paymentsFor ? getPlanRates(paymentsFor.id) : undefined}
        onOpenChange={(o) => { if (!o) setPaymentsFor(null); }}
        onRecorded={load}
      />

      <CompanyRolesDialog
        companyId={rolesFor?.id ?? null}
        companyName={rolesFor?.name ?? ''}
        open={rolesFor !== null}
        onOpenChange={(o) => { if (!o) setRolesFor(null); }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar empresa' : step === 1 ? 'Nueva empresa (Paso 1/2)' : 'Crear Administrador (Paso 2/2)'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Gestiona los datos de la empresa, su plan y su estado fiscal (DGII).'
                : step === 1
                  ? 'Completa la información general de la nueva empresa.'
                  : 'Registra los datos de la persona que administrará esta empresa.'}
            </DialogDescription>
          </DialogHeader>

          {step === 1 || editingId ? (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Nombre *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              {!editingId && (
                <>
                  <div className="grid gap-2">
                    <Label>Tipo de negocio</Label>
                    <Select value={form.businessType} onValueChange={(v) => setForm({ ...form, businessType: v as BusinessType })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(BUSINESS_TYPE_PRESETS).map(([key, preset]) => (
                          <SelectItem key={key} value={key}>{preset.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {BUSINESS_TYPE_PRESETS[form.businessType].description}
                    </p>
                  </div>
                  {form.businessType === 'otro' && (
                    <div className="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      <Label htmlFor="custom-business-type">Especificar sector *</Label>
                      <Input
                        id="custom-business-type"
                        placeholder="Ej: Peluquería, Gimnasio, etc."
                        value={form.customBusinessType}
                        onChange={(e) => setForm({ ...form, customBusinessType: e.target.value })}
                        required
                      />
                    </div>
                  )}
                </>
              )}
              {editingId && form.businessType === 'otro' && (
                <div className="grid gap-2 animate-in fade-in duration-200">
                  <Label htmlFor="custom-business-type">Sector / Rubro</Label>
                  <Input
                    id="custom-business-type"
                    placeholder="Ej: Peluquería, Gimnasio, etc."
                    value={form.customBusinessType}
                    onChange={(e) => setForm({ ...form, customBusinessType: e.target.value })}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="rnc">RNC (opcional)</Label>
                  <Input id="rnc" value={form.rnc} onChange={(e) => setForm({ ...form, rnc: e.target.value })} placeholder="Solo si está formalizada" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="address">Dirección</Label>
                <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Estado</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Company['status'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Prueba</SelectItem>
                      <SelectItem value="active">Activa</SelectItem>
                      <SelectItem value="suspended">Suspendida</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Plan</Label>
                  <Select value={form.planId} onValueChange={handlePlanChange}>
                    <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin plan</SelectItem>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {plans.find((p) => p.id === form.planId)?.name === CUSTOM_PLAN_NAME && (
                <div className="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <Label htmlFor="customMonthlyPrice">Monto mensual acordado (RD$)</Label>
                  <Input
                    id="customMonthlyPrice"
                    type="number"
                    min={0}
                    placeholder="Ej: 3500"
                    value={form.customMonthlyPrice}
                    onChange={(e) => setForm({ ...form, customMonthlyPrice: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Precio negociado con esta empresa para el plan "A medida". Se usa como referencia en el panel de super admin.
                  </p>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="maxUsers">Límite de usuarios *</Label>
                <Input
                  id="maxUsers"
                  type="number"
                  min={1}
                  value={form.maxUsers}
                  onChange={(e) => setForm({ ...form, maxUsers: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3 bg-amber-500/5 border-amber-500/20">
                <div>
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">¿Es empresa Demo?</p>
                  <p className="text-xs text-muted-foreground font-normal">Excluye esta empresa de estadísticas y reportes reales.</p>
                </div>
                <Switch checked={form.isDemo} onCheckedChange={(v) => setForm({ ...form, isDemo: v })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Formalizada en DGII</p>
                  <p className="text-xs text-muted-foreground">Activa si la empresa tiene RNC y opera formalmente.</p>
                </div>
                <Switch checked={form.isFormalized} onCheckedChange={(v) => setForm({ ...form, isFormalized: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Emite comprobantes (NCF / e-CF)</p>
                  <p className="text-xs text-muted-foreground">Habilita la facturación fiscal para esta empresa.</p>
                </div>
                <Switch checked={form.ncfEnabled} onCheckedChange={(v) => setForm({ ...form, ncfEnabled: v })} />
              </div>

              {editingId && (
                <>
                  <p className="text-sm font-semibold mt-2">Compartir entre sucursales</p>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Clientes compartidos</p>
                      <p className="text-xs text-muted-foreground">Todas las sucursales ven la misma lista de clientes.</p>
                    </div>
                    <Switch checked={sharing.clientes} onCheckedChange={(v) => setSharing({ ...sharing, clientes: v })} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Crédito compartido</p>
                      <p className="text-xs text-muted-foreground">Las ventas a crédito se pueden ver y cobrar desde cualquier sucursal.</p>
                    </div>
                    <Switch checked={sharing.credito} onCheckedChange={(v) => setSharing({ ...sharing, credito: v })} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Financiamiento compartido</p>
                      <p className="text-xs text-muted-foreground">Los financiamientos se pueden ver y pagar desde cualquier sucursal.</p>
                    </div>
                    <Switch checked={sharing.financiamiento} onCheckedChange={(v) => setSharing({ ...sharing, financiamiento: v })} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Préstamos compartidos</p>
                      <p className="text-xs text-muted-foreground">Los préstamos de dinero se pueden ver y cobrar desde cualquier sucursal.</p>
                    </div>
                    <Switch checked={sharing.prestamos} onCheckedChange={(v) => setSharing({ ...sharing, prestamos: v })} />
                  </div>
                </>
              )}
            </div>
          ) : step === 2 ? (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="adminName">Nombre del Administrador *</Label>
                <Input
                  id="adminName"
                  value={form.adminName}
                  onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                  placeholder="Ej: Carlos Gómez"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adminEmail">Email de Acceso *</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                  placeholder="admin@empresa.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="adminPassword">Contraseña *</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="adminConfirmPassword">Confirmar Contraseña *</Label>
                  <Input
                    id="adminConfirmPassword"
                    type="password"
                    value={form.adminConfirmPassword}
                    onChange={(e) => setForm({ ...form, adminConfirmPassword: e.target.value })}
                    placeholder="Repite la contraseña"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 py-2 max-h-[400px] overflow-y-auto pr-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Usuarios Adicionales (Opcional)</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExtraUsers([...extraUsers, { name: '', email: '', password: '', confirmPassword: '', role: 'cashier' }])}
                >
                  <PlusCircle className="mr-1 h-3.5 w-3.5" /> Agregar usuario
                </Button>
              </div>

              {extraUsers.map((u, idx) => (
                <div key={idx} className="relative border p-3 rounded-lg bg-muted/20 space-y-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                    onClick={() => setExtraUsers(extraUsers.filter((_, i) => i !== idx))}
                  >
                    ×
                  </Button>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Usuario #{idx + 1}</p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs">Nombre *</Label>
                      <Input
                        value={u.name}
                        onChange={(e) => {
                          const updated = [...extraUsers];
                          updated[idx].name = e.target.value;
                          setExtraUsers(updated);
                        }}
                        placeholder="Nombre completo"
                        required
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Email *</Label>
                      <Input
                        type="email"
                        value={u.email}
                        onChange={(e) => {
                          const updated = [...extraUsers];
                          updated[idx].email = e.target.value;
                          setExtraUsers(updated);
                        }}
                        placeholder="correo@empresa.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs">Contraseña *</Label>
                      <Input
                        type="password"
                        value={u.password}
                        onChange={(e) => {
                          const updated = [...extraUsers];
                          updated[idx].password = e.target.value;
                          setExtraUsers(updated);
                        }}
                        placeholder="Mínimo 8 caracteres"
                        required
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Confirmar Contraseña *</Label>
                      <Input
                        type="password"
                        value={u.confirmPassword}
                        onChange={(e) => {
                          const updated = [...extraUsers];
                          updated[idx].confirmPassword = e.target.value;
                          setExtraUsers(updated);
                        }}
                        placeholder="Repite la contraseña"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid gap-1">
                    <Label className="text-xs">Rol *</Label>
                    <Select
                      value={u.role}
                      onValueChange={(val) => {
                        const updated = [...extraUsers];
                        updated[idx].role = val as 'admin' | 'cashier';
                        setExtraUsers(updated);
                      }}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="cashier">Cajero</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}

              {extraUsers.length === 0 && (
                <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg">
                  No has agregado ningún usuario adicional. Haz clic en "Agregar usuario" para registrar más accesos.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {editingId ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
              </>
            ) : step === 1 ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>
                  Siguiente <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : step === 2 ? (
              <>
                <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  Siguiente <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(2)} disabled={saving}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Creando...' : 'Guardar y Crear'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompanyModulesDialog
        companyId={modulesFor?.id ?? null}
        companyName={modulesFor?.name ?? ''}
        open={modulesFor !== null}
        onOpenChange={(o) => { if (!o) setModulesFor(null); }}
      />

      <Dialog open={editingBranch !== null} onOpenChange={(o) => { if (!o) setEditingBranch(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Sucursal</DialogTitle>
            <DialogDescription>Modifica los detalles de esta sucursal.</DialogDescription>
          </DialogHeader>
          {editingBranch && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="branchName" className="text-right">Nombre</Label>
                <Input
                  id="branchName"
                  value={editingBranch.name}
                  onChange={e => setEditingBranch({ ...editingBranch, name: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="branchLocation" className="text-right">Ubicación</Label>
                <Input
                  id="branchLocation"
                  value={editingBranch.location}
                  onChange={e => setEditingBranch({ ...editingBranch, location: e.target.value })}
                  className="col-span-3"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBranch(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSaveBranch} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={statusTarget !== null} onOpenChange={(o) => { if (!o) setStatusTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.status === 'suspended' ? '¿Reactivar esta empresa?' : '¿Desactivar esta empresa?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.status === 'suspended'
                ? `“${statusTarget?.name}” volverá a estar activa y sus usuarios podrán acceder de nuevo.`
                : `“${statusTarget?.name}” quedará suspendida. Sus usuarios no podrán acceder hasta que la reactives.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleToggleStatus(); }}
              disabled={saving}
              className={statusTarget?.status === 'suspended' ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
            >
              {saving ? 'Guardando…' : statusTarget?.status === 'suspended' ? 'Reactivar' : 'Desactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeleteConfirmDialog
        open={deleteCompanyTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteCompanyTarget(null); }}
        title="Eliminar empresa definitivamente"
        description={`Esto borra "${deleteCompanyTarget?.name ?? ''}" y TODO su historial: sucursales, ventas, clientes, financiamientos y usuarios. No se puede deshacer.`}
        confirmName={deleteCompanyTarget?.name ?? ''}
        onConfirm={handleDeleteCompany}
      />

      <DeleteConfirmDialog
        open={deleteBranchTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteBranchTarget(null); }}
        title="Eliminar sucursal definitivamente"
        description={`Esto borra "${deleteBranchTarget?.name ?? ''}" y sus ventas, gastos, cotizaciones y servicios. Los usuarios y clientes quedan en la empresa, solo se desvinculan de esta sucursal. No se puede deshacer.`}
        confirmName={deleteBranchTarget?.name ?? ''}
        onConfirm={handleDeleteBranch}
      />

      <Dialog open={addBranchFor !== null} onOpenChange={(o) => { if (!o) setAddBranchFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar sucursal</DialogTitle>
            <DialogDescription>Nueva sucursal para {addBranchFor?.name}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="newBranchName">Nombre</Label>
              <Input id="newBranchName" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} placeholder="Ej: Santiago" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newBranchLocation">Ubicación</Label>
              <Input id="newBranchLocation" value={newBranchLocation} onChange={(e) => setNewBranchLocation(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddBranchFor(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleAddBranch} disabled={saving || !newBranchName.trim()}>
              {saving ? 'Creando…' : 'Crear sucursal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={branchStatusTarget !== null} onOpenChange={(o) => { if (!o) setBranchStatusTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {branchStatusTarget?.isActive ? '¿Desactivar esta sucursal?' : '¿Reactivar esta sucursal?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {branchStatusTarget?.isActive
                ? `Los usuarios de "${branchStatusTarget?.name}" no podrán acceder hasta que la reactives. No se borra ningún dato.`
                : `"${branchStatusTarget?.name}" volverá a estar activa y sus usuarios podrán acceder de nuevo.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleToggleBranchStatus(); }}
              disabled={saving}
              className={branchStatusTarget?.isActive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {saving ? 'Guardando…' : branchStatusTarget?.isActive ? 'Desactivar' : 'Reactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManageCompanyUsersDialog
        companyId={manageUsersFor?.id ?? null}
        companyName={manageUsersFor?.name ?? ''}
        open={manageUsersFor !== null}
        onOpenChange={(o) => { if (!o) setManageUsersFor(null); }}
      />
    </div>
  );
}
