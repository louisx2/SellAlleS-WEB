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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Pencil, Building2 } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  rnc: string | null;
  is_formalized: boolean;
  ncf_enabled: boolean;
  phone: string | null;
  address: string | null;
  status: 'trial' | 'active' | 'suspended';
  created_at: string;
}
interface Plan { id: string; name: string; price: number; }
interface Sub { id: string; company_id: string; plan_id: string | null; }

const NONE = 'none';
const STATUS_LABEL: Record<string, string> = { trial: 'Prueba', active: 'Activa', suspended: 'Suspendida' };
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  active: 'default', trial: 'secondary', suspended: 'destructive',
};

const emptyForm = {
  name: '', rnc: '', phone: '', address: '',
  status: 'trial' as Company['status'], planId: NONE,
  isFormalized: false, ncfEnabled: false,
};

export default function CompaniesAdminPage() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Record<string, Sub>>({});
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: comps }, { data: pls }, { data: ss }] = await Promise.all([
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('plans').select('id, name, price').order('price'),
      supabase.from('subscriptions').select('id, company_id, plan_id'),
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

  const planName = (companyId: string) => {
    const sub = subs[companyId];
    if (!sub?.plan_id) return '—';
    return plans.find((p) => p.id === sub.plan_id)?.name ?? '—';
  };

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (c: Company) => {
    setEditingId(c.id);
    setForm({
      name: c.name, rnc: c.rnc ?? '', phone: c.phone ?? '', address: c.address ?? '',
      status: c.status, planId: subs[c.id]?.plan_id ?? NONE,
      isFormalized: c.is_formalized, ncfEnabled: c.ncf_enabled,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Falta el nombre', description: 'Escribe el nombre de la empresa.', variant: 'destructive' });
      return;
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

      // Plan (suscripción)
      if (companyId && form.planId !== NONE) {
        const existing = subs[companyId];
        if (existing) {
          await supabase.from('subscriptions').update({ plan_id: form.planId }).eq('id', existing.id);
        } else {
          await supabase.from('subscriptions').insert({ company_id: companyId, plan_id: form.planId, status: 'active' });
        }
      }

      toast({ title: editingId ? 'Empresa actualizada' : 'Empresa creada', description: form.name });
      setOpen(false);
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'No se pudo guardar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Plataforma — Empresas">
        <Button onClick={openCreate}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Nueva empresa
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>RNC</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Formalizada</TableHead>
                <TableHead>e-CF</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              ) : companies.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Aún no hay empresas.</TableCell></TableRow>
              ) : (
                companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {c.name}
                      </div>
                    </TableCell>
                    <TableCell>{c.rnc || '—'}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge></TableCell>
                    <TableCell>{c.is_formalized ? 'Sí' : 'No'}</TableCell>
                    <TableCell>{c.ncf_enabled ? 'Sí' : 'No'}</TableCell>
                    <TableCell>{planName(c.id)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar empresa' : 'Nueva empresa'}</DialogTitle>
            <DialogDescription>
              Gestiona los datos de la empresa, su plan y su estado fiscal (DGII).
            </DialogDescription>
          </DialogHeader>

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

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
