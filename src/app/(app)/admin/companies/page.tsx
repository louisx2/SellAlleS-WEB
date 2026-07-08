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
import { PlusCircle, ArrowRight, ArrowLeft } from 'lucide-react';
import { CompanyModulesDialog } from '@/components/admin/company-modules-dialog';
import { DashboardStats } from '@/components/admin/dashboard-stats';
import { CompaniesDataTable } from '@/components/admin/companies-data-table';
import { PlatformSalesChart, CompaniesGrowthChart } from '@/components/admin/platform-charts';
import {
  TopCompaniesCard, PlanDistributionCard, AttentionCard,
  type TopCompany, type PlanSlice, type AttentionItem,
} from '@/components/admin/platform-insights';
import { createClient } from '@supabase/supabase-js';
import type { Company } from '@/lib/types';

interface Plan { id: string; name: string; price: number; }
interface Sub { id: string; company_id: string; plan_id: string | null; }
interface PlatformSale { company_id: string | null; total: number; created_at: string; }

const NONE = 'none';

const emptyForm = {
  name: '', rnc: '', phone: '', address: '',
  status: 'trial' as Company['status'], planId: NONE,
  isFormalized: false, ncfEnabled: false,
  adminName: '', adminEmail: '', adminPassword: '',
};

export default function CompaniesAdminPage() {
  const { appUser, setImpersonatedCompany, setActiveBranch } = useAuth();
  const { toast } = useToast();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [totalUsers, setTotalUsers] = useState(0);
  const [newUsersWeek, setNewUsersWeek] = useState(0);
  const [platformSales, setPlatformSales] = useState<PlatformSale[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  
  const [modulesFor, setModulesFor] = useState<Company | null>(null);
  const [editingBranch, setEditingBranch] = useState<{ id: string; name: string; location: string; companyId: string } | null>(null);

  const load = useCallback(async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [
      { data: comps },
      { data: pls },
      { data: ss },
      { data: profs },
      { data: sls },
    ] = await Promise.all([
      supabase.from('companies').select('*, branches(id, name, location)').order('created_at', { ascending: false }),
      supabase.from('plans').select('id, name, price').order('price'),
      supabase.from('subscriptions').select('id, company_id, plan_id'),
      supabase.from('profiles').select('id, created_at'),
      // RLS: el super admin ve las ventas de todos los tenants.
      supabase.from('sales').select('company_id, total, created_at').gte('created_at', thirtyDaysAgo.toISOString()),
    ]);

    if (comps) setCompanies(comps as Company[]);
    if (pls) setPlans(pls as Plan[]);
    if (ss) {
      const map: Record<string, Sub> = {};
      (ss as Sub[]).forEach((s) => { map[s.company_id] = s; });
      setSubs(map);
    }
    if (profs) {
      setTotalUsers(profs.length);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      setNewUsersWeek(profs.filter((p: any) => p.created_at && new Date(p.created_at) > weekAgo).length);
    }
    if (sls) setPlatformSales((sls as any[]).map((s) => ({ ...s, total: Number(s.total) })));

    setLoading(false);
  }, []);

  useEffect(() => { if (appUser?.isSuperAdmin) load(); }, [appUser, load]);

  if (!appUser?.isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Plataforma" />
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

  const openCreate = () => { setEditingId(null); setStep(1); setForm(emptyForm); setOpen(true); };
  const openEdit = (c: Company) => {
    setEditingId(c.id);
    setStep(1);
    setForm({
      name: c.name, rnc: c.rnc ?? '', phone: c.phone ?? '', address: c.address ?? '',
      status: c.status, planId: subs[c.id]?.plan_id ?? NONE,
      isFormalized: c.is_formalized, ncfEnabled: c.ncf_enabled,
      adminName: '', adminEmail: '', adminPassword: '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Falta el nombre', description: 'Escribe el nombre de la empresa.', variant: 'destructive' });
      return;
    }

    if (!editingId && step === 1) {
      setStep(2);
      return;
    }

    if (!editingId && step === 2) {
      if (!form.adminName.trim() || !form.adminEmail.trim() || !form.adminPassword.trim()) {
        toast({ title: 'Datos incompletos', description: 'Por favor completa todos los campos del administrador.', variant: 'destructive' });
        return;
      }
      if (form.adminPassword.length < 6) {
        toast({ title: 'Contraseña débil', description: 'La contraseña debe tener al menos 6 caracteres.', variant: 'destructive' });
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

      if (companyId && form.planId !== NONE) {
        const existing = subs[companyId];
        if (existing) {
          await supabase.from('subscriptions').update({ plan_id: form.planId }).eq('id', existing.id);
        } else {
          await supabase.from('subscriptions').insert({ company_id: companyId, plan_id: form.planId, status: 'active' });
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
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: authData.user.id,
              email: form.adminEmail.trim(),
              name: form.adminName.trim(),
              role: 'admin',
              company_id: companyId,
              branch_id: branchData.id,
            });

          if (profileError) throw profileError;

          await supabase
            .from('profile_branches')
            .insert({ profile_id: authData.user.id, branch_id: branchData.id });
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

  // ---------- Métricas de la plataforma ----------
  const activeCompanies = companies.filter(c => c.status === 'active').length;
  const trialCompanies = companies.filter(c => c.status === 'trial').length;
  const suspendedCompanies = companies.filter(c => c.status === 'suspended').length;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newCompaniesWeek = companies.filter((c) => c.created_at && new Date(c.created_at) > oneWeekAgo).length;

  let projectedMRR = 0;
  let payingCompanies = 0;
  companies.forEach(c => {
    if (c.status === 'active') {
      const planId = subs[c.id]?.plan_id;
      const planPrice = plans.find(p => p.id === planId)?.price || 0;
      if (planPrice > 0) payingCompanies += 1;
      projectedMRR += planPrice;
    }
  });

  const platformSales30d = platformSales.reduce((acc, s) => acc + s.total, 0);
  const platformTx30d = platformSales.length;

  // Ventas por día (últimos 14 días, todos los tenants).
  const salesByDay: { name: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const total = platformSales
      .filter((s) => { const d = new Date(s.created_at); return d >= day && d < next; })
      .reduce((acc, s) => acc + s.total, 0);
    salesByDay.push({ name: day.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }), total });
  }

  // Altas de empresas por mes (últimos 6 meses).
  const companiesByMonth: { name: string; nuevas: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const month = new Date();
    month.setDate(1);
    month.setMonth(month.getMonth() - i);
    const label = month.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' });
    const nuevas = companies.filter((c) => {
      if (!c.created_at) return false;
      const d = new Date(c.created_at);
      return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
    }).length;
    companiesByMonth.push({ name: label, nuevas });
  }

  // Top empresas por ventas (30 días).
  const salesByCompany = new Map<string, { total: number; txCount: number }>();
  platformSales.forEach((s) => {
    if (!s.company_id) return;
    const agg = salesByCompany.get(s.company_id) ?? { total: 0, txCount: 0 };
    agg.total += s.total;
    agg.txCount += 1;
    salesByCompany.set(s.company_id, agg);
  });
  const topCompanies: TopCompany[] = [...salesByCompany.entries()]
    .map(([companyId, agg]) => ({ company: companies.find((c) => c.id === companyId), ...agg }))
    .filter((t): t is TopCompany => t.company !== undefined)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Distribución por plan.
  const planSlices: PlanSlice[] = plans.map((p) => ({
    name: p.name,
    price: p.price,
    count: companies.filter((c) => subs[c.id]?.plan_id === p.id).length,
  }));
  const withoutPlan = companies.filter((c) => !subs[c.id]?.plan_id).length;
  if (withoutPlan > 0) planSlices.push({ name: 'Sin plan', price: 0, count: withoutPlan });

  // Empresas que requieren seguimiento.
  const attentionItems: AttentionItem[] = [];
  companies.forEach((c) => {
    if (c.status === 'suspended') {
      attentionItems.push({ company: c, reason: 'Suspendida', severity: 'destructive' });
    } else if (c.status === 'trial' && c.created_at) {
      const days = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000);
      if (days > 14) attentionItems.push({ company: c, reason: `En prueba hace ${days} días`, severity: 'warn' });
    } else if (c.status === 'active' && !subs[c.id]?.plan_id) {
      attentionItems.push({ company: c, reason: 'Activa sin plan', severity: 'warn' });
    }
  });
  attentionItems.sort((a) => (a.severity === 'destructive' ? -1 : 1));

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plataforma</h1>
          <p className="text-muted-foreground mt-1">Gestión centralizada del SaaS y todas sus instancias.</p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto shadow-sm">
          <PlusCircle className="mr-2 h-4 w-4" />
          Nueva empresa
        </Button>
      </div>

      <DashboardStats
        totalCompanies={companies.length}
        activeCompanies={activeCompanies}
        trialCompanies={trialCompanies}
        suspendedCompanies={suspendedCompanies}
        newCompaniesWeek={newCompaniesWeek}
        totalUsers={totalUsers}
        newUsersWeek={newUsersWeek}
        projectedMRR={projectedMRR}
        payingCompanies={payingCompanies}
        platformSales30d={platformSales30d}
        platformTx30d={platformTx30d}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformSalesChart data={salesByDay} />
        <CompaniesGrowthChart data={companiesByMonth} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopCompaniesCard items={topCompanies} />
        <PlanDistributionCard slices={planSlices} totalCompanies={companies.length} />
        <AttentionCard items={attentionItems} onEdit={openEdit} />
      </div>

      <CompaniesDataTable
        companies={companies}
        loading={loading}
        onEditCompany={openEdit}
        onModulesCompany={setModulesFor}
        onEnterCompany={(c) => setImpersonatedCompany(c.id, c.name)}
        onEnterBranch={(cId, cName, bId, bName) => {
          setActiveBranch(bId, bName);
          setImpersonatedCompany(cId, cName);
        }}
        onEditBranch={setEditingBranch}
        getPlanName={getPlanName}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
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
                  <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}>
                    <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin plan</SelectItem>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} (RD${p.price})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
            </div>
          ) : (
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
              <div className="grid gap-2">
                <Label htmlFor="adminPassword">Contraseña de Acceso *</Label>
                <Input 
                  id="adminPassword" 
                  type="password"
                  value={form.adminPassword} 
                  onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} 
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
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
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>
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
    </div>
  );
}
