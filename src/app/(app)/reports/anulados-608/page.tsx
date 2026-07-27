'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { usePermission } from '@/hooks/use-permission';
import { supabase } from '@/lib/supabase/client';
import { rowToVoidedNcf } from '@/lib/supabase/mappers';
import type { VoidedNcf } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { ExportButton } from '@/components/reports/export-button';
import {
  VOID_REASONS_608, DGII_608_HEADERS, buildDetailFields, build608Txt,
  dgii608FileName, download608Txt, isValidNcfFormat,
} from '@/lib/dgii-608';
import { FileDown, Hash, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';

// Período por defecto: el mes anterior (el 608 se remite el mes siguiente).
const defaultPeriod = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // yyyy-mm
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Anulados608Page() {
  const { profile } = useCompanyProfile();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const { toast } = useToast();
  const canCreate = usePermission('reports', 'create') || appUser?.role === 'admin';

  const [period, setPeriod] = useState(defaultPeriod());
  const [rows, setRows] = useState<VoidedNcf[]>([]);

  // Formulario de registro
  const [ncf, setNcf] = useState('');
  const [voidedDate, setVoidedDate] = useState(todayIso());
  const [reasonCode, setReasonCode] = useState('04');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('voided_ncf')
      .select('*')
      .order('voided_date', { ascending: false });
    setRows((data ?? []).map(rowToVoidedNcf));
  }, []);

  useEffect(() => { load(); }, [load]);

  const periodRows = useMemo(
    () => rows.filter((r) => r.voidedDate?.startsWith(period)),
    [rows, period]
  );

  const activeBranch = branches.find((b) => b.id === appUser?.activeBranchId);
  const activeRnc = activeBranch?.rnc || profile.rnc || '';
  const companyRnc = activeRnc.replace(/\D/g, '');

  if (!profile.isFormalized) {
    return (
      <div>
        <PageHeader title="NCF Anulados (Formato 608)" />
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Solo para empresas formalizadas</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            El Formato 608 informa a la DGII los comprobantes fiscales anulados en el período.
            Cuando tu empresa esté formalizada (RNC y comprobantes fiscales), podrás registrarlos
            y generar el archivo aquí.
          </p>
        </div>
      </div>
    );
  }

  const handleAdd = async () => {
    const cleaned = ncf.trim().toUpperCase();
    if (!isValidNcfFormat(cleaned)) {
      toast({
        title: 'NCF inválido',
        description: 'El NCF debe tener el formato B0100000001 (o e-CF).',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('voided_ncf').insert({
      ncf: cleaned,
      voided_date: voidedDate,
      reason_code: reasonCode,
      notes: notes.trim() || null,
      user_name: appUser?.name ?? null,
    });
    setSaving(false);
    if (error) {
      toast({
        title: 'No se pudo registrar',
        description: error.message.includes('voided_ncf_company_ncf_key')
          ? 'Ese NCF ya está registrado como anulado.'
          : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'NCF anulado registrado', description: cleaned });
    setNcf('');
    setNotes('');
    load();
  };

  const handleDelete = async (row: VoidedNcf) => {
    const { error } = await supabase.from('voided_ncf').delete().eq('id', row.id);
    if (error) {
      toast({ title: 'No se pudo eliminar', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const handleDownloadTxt = () => {
    const content = build608Txt(companyRnc, period, periodRows);
    download608Txt(dgii608FileName(companyRnc, period), content);
  };

  const reasonLabel = (code: string) =>
    VOID_REASONS_608.find((r) => r.code === code)?.label ?? code;

  const csvColumns = [
    ...DGII_608_HEADERS.map((h, i) => ({ header: h, value: (r: VoidedNcf) => buildDetailFields(r)[i] })),
    { header: 'Notas', value: (r: VoidedNcf) => r.notes ?? '' },
    { header: 'Registrado por', value: (r: VoidedNcf) => r.userName ?? '' },
  ];

  return (
    <div>
      <PageHeader title="NCF Anulados (Formato 608)">
        <div className="flex items-center gap-2">
          <ExportButton filename={`anulados_608_${period.replace('-', '')}`} rows={periodRows} columns={csvColumns} />
          <Button onClick={handleDownloadTxt} disabled={periodRows.length === 0 || !companyRnc}>
            <FileDown className="mr-2 h-4 w-4" />
            TXT DGII
          </Button>
        </div>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="periodo-608">Período (mes)</Label>
          <Input
            id="periodo-608"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="w-[180px]"
          />
        </div>
        {!companyRnc && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            La sucursal actual no tiene RNC configurado (Perfil de Sucursal): se necesita para el archivo de envío.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">NCF anulados del período</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{periodRows.length}</div>
            <p className="text-xs text-muted-foreground">Comprobantes del período {period}</p>
          </CardContent>
        </Card>
        <Card className="sm:col-span-1">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Aquí van los NCF <span className="font-medium text-foreground">quemados sin efecto</span> (deterioro,
            error de impresión o digitación, cese). Las ventas anuladas con Nota de Crédito B04
            <span className="font-medium text-foreground"> no se registran aquí</span>: van en el 607 junto a su NC.
          </CardContent>
        </Card>
      </div>

      {canCreate && (
        <div className="mb-6 rounded-lg border p-4 space-y-4 bg-card">
          <h4 className="text-sm font-semibold">Registrar NCF anulado</h4>
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ncf-608" className="text-xs">NCF</Label>
              <Input
                id="ncf-608"
                placeholder="B0100000123"
                value={ncf}
                onChange={(e) => setNcf(e.target.value.toUpperCase())}
                className="font-mono"
                maxLength={13}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fecha-608" className="text-xs">Fecha de anulación</Label>
              <Input
                id="fecha-608"
                type="date"
                value={voidedDate}
                onChange={(e) => e.target.value && setVoidedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Motivo</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VOID_REASONS_608.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1 flex-1 min-w-[240px]">
              <Label htmlFor="notas-608" className="text-xs">Notas (opcional, no van a DGII)</Label>
              <Textarea
                id="notas-608"
                rows={1}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: se dañó al imprimir"
              />
            </div>
            <Button type="button" onClick={handleAdd} disabled={saving || !ncf.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Registrar
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NCF</TableHead>
              <TableHead>Fecha Anulación</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Notas</TableHead>
              <TableHead>Registrado por</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periodRows.length ? (
              periodRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.ncf}</TableCell>
                  <TableCell>{r.voidedDate}</TableCell>
                  <TableCell>{reasonLabel(r.reasonCode)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.notes ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.userName ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {canCreate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Eliminar</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No hay NCF anulados registrados en este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Valida el archivo TXT con la herramienta de pre-validación de la DGII antes de remitirlo por Oficina Virtual.
        Si un período no tiene NCF anulados, el 608 no se remite (o se remite en cero, según indique tu contador).
      </p>
    </div>
  );
}
