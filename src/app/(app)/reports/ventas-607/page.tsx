'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useBranches } from '@/context/branch-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditNote } from '@/lib/supabase/mappers';
import type { CreditNote } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { ExportButton } from '@/components/reports/export-button';
import {
  DGII_607_HEADERS, classify607, build607Txt, dgii607FileName, download607Txt,
  type Dgii607Row,
} from '@/lib/dgii-607';
import { FileDown, FileWarning, Hash, Receipt, TrendingUp, ShieldAlert } from 'lucide-react';

// Período por defecto: el mes anterior (el 607 se remite el mes siguiente).
const defaultPeriod = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // yyyy-mm
};

export default function Ventas607Page() {
  const { sales } = useSales();
  const { profile } = useCompanyProfile();
  const { branches } = useBranches();
  const { appUser } = useAuth();
  const [period, setPeriod] = useState(defaultPeriod());
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);

  // Las notas de crédito (B04) del período también van al 607.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('credit_notes')
        .select('*, customers(name, rnc)')
        .order('created_at', { ascending: false });
      if (!cancelled) setCreditNotes((data ?? []).map(rowToCreditNote));
    })();
    return () => { cancelled = true; };
  }, []);

  // Mes local del documento (createdAt es Date): evita que un documento de fin
  // de mes salte de período por el desfase UTC (RD es UTC-4).
  const periodSales = useMemo(
    () => sales.filter((s) => format(s.createdAt, 'yyyy-MM') === period),
    [sales, period]
  );
  const periodNotes = useMemo(
    () => creditNotes.filter((n) => format(n.createdAt, 'yyyy-MM') === period),
    [creditNotes, period]
  );
  const { rows, excluded } = useMemo(
    () => classify607(periodSales, periodNotes),
    [periodSales, periodNotes]
  );

  // Totales netos del período: ventas menos notas de crédito (así cuadra con
  // lo que DGII neta por tipo de comprobante).
  const totals = useMemo(() => {
    let facturado = 0, itbis = 0;
    for (const r of rows) {
      const sign = r.kind === 'credit_note' ? -1 : 1;
      facturado += sign * r.subtotal;
      itbis += sign * r.itbis;
    }
    return { facturado, itbis };
  }, [rows]);

  const activeBranch = branches.find((b) => b.id === appUser?.activeBranchId);
  const activeRnc = activeBranch?.rnc || profile.rnc || '';
  const companyRnc = activeRnc.replace(/\D/g, '');

  if (!profile.isFormalized) {
    return (
      <div>
        <PageHeader title="Ventas (Formato 607)" />
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Solo para empresas formalizadas</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            El Formato 607 es la remisión mensual de ventas de bienes y servicios a la DGII.
            Cuando tu empresa esté formalizada (RNC y comprobantes fiscales), podrás generarlo aquí
            a partir de las ventas con NCF.
          </p>
        </div>
      </div>
    );
  }

  const handleDownloadTxt = () => {
    const content = build607Txt(companyRnc, period, rows);
    download607Txt(dgii607FileName(companyRnc, period), content);
  };

  const csvColumns = [
    { header: 'Cliente', value: (r: Dgii607Row) => r.customerName ?? '' },
    { header: 'Documento', value: (r: Dgii607Row) => (r.kind === 'credit_note' ? 'Nota de Crédito' : 'Venta') },
    ...DGII_607_HEADERS.map((h, i) => ({ header: h, value: (r: Dgii607Row) => r.fields[i] })),
  ];

  return (
    <div>
      <PageHeader title="Ventas (Formato 607)">
        <div className="flex items-center gap-2">
          <ExportButton filename={`ventas_607_${period.replace('-', '')}`} rows={rows} columns={csvColumns} />
          <Button onClick={handleDownloadTxt} disabled={rows.length === 0 || !companyRnc}>
            <FileDown className="mr-2 h-4 w-4" />
            TXT DGII
          </Button>
        </div>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="periodo-607">Período (mes)</Label>
          <Input
            id="periodo-607"
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

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registros del 607</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
            <p className="text-xs text-muted-foreground">
              Comprobantes del período {period}
              {periodNotes.length > 0 ? ` (incluye ${periodNotes.length} nota${periodNotes.length === 1 ? '' : 's'} de crédito)` : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monto Facturado (neto)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.facturado)}</div>
            <p className="text-xs text-muted-foreground">Ventas sin ITBIS, menos notas de crédito</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ITBIS Facturado (neto)</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.itbis)}</div>
            <p className="text-xs text-muted-foreground">ITBIS de ventas con NCF, menos devoluciones</p>
          </CardContent>
        </Card>
      </div>

      {excluded.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300 mb-2">
            <FileWarning className="h-4 w-4" />
            {excluded.length} documento{excluded.length === 1 ? '' : 's'} del período excluido{excluded.length === 1 ? '' : 's'} del 607
          </div>
          <ul className="space-y-1 text-sm text-amber-800/90 dark:text-amber-300/90">
            {excluded.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                {e.kind === 'credit_note' ? 'NC · ' : ''}
                {e.customerName ?? 'Consumidor final'} · {formatCurrency(e.total)} · {format(e.date, 'dd/MM/yyyy')} — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Cliente</TableHead>
              {DGII_607_HEADERS.map((h) => (
                <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {r.kind === 'credit_note' && (
                      <Badge variant="destructive" className="mr-2 text-[10px]">NC</Badge>
                    )}
                    {r.customerName ?? '—'}
                  </TableCell>
                  {r.fields.map((f, i) => (
                    <TableCell key={i} className="whitespace-nowrap">{f || '—'}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={DGII_607_HEADERS.length + 1} className="h-24 text-center">
                  No hay ventas con NCF en este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Valida el archivo TXT con la herramienta de pre-validación de la DGII antes de remitirlo por Oficina Virtual.
        Solo entran al 607 las ventas con NCF y las notas de crédito (B04) con NCF; los comprobantes de Crédito
        Fiscal (B01) requieren RNC/cédula válido del cliente. Las ventas anuladas se reportan junto a su nota de crédito.
      </p>
    </div>
  );
}
