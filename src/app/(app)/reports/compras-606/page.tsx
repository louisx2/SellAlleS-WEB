'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { usePayables } from '@/context/payables-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { ExportButton } from '@/components/reports/export-button';
import {
  DGII_606_HEADERS, classify606, build606Txt, dgii606FileName, download606Txt,
  type Dgii606Row,
} from '@/lib/dgii-606';
import { FileDown, FileWarning, Hash, Receipt, ShoppingBag, ShieldAlert } from 'lucide-react';

// Período por defecto: el mes anterior (el 606 se remite el mes siguiente).
const defaultPeriod = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // yyyy-mm
};

export default function Compras606Page() {
  const { invoices } = usePayables();
  const { profile } = useCompanyProfile();
  const [period, setPeriod] = useState(defaultPeriod());

  const periodInvoices = useMemo(
    () => invoices.filter((i) => i.issueDate?.startsWith(period)),
    [invoices, period]
  );
  const { rows, excluded } = useMemo(() => classify606(periodInvoices), [periodInvoices]);

  const totals = useMemo(() => {
    let compras = 0, itbis = 0, retenido = 0;
    for (const r of rows) {
      compras += r.invoice.subtotalGoods + r.invoice.subtotalServices;
      itbis += r.invoice.itbisFacturado;
      retenido += r.invoice.itbisRetenido + r.invoice.isrRetentionAmount;
    }
    return { compras, itbis, retenido };
  }, [rows]);

  const companyRnc = (profile.rnc ?? '').replace(/\D/g, '');

  if (!profile.isFormalized) {
    return (
      <div>
        <PageHeader title="Compras (Formato 606)" />
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Solo para empresas formalizadas</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            El Formato 606 es la remisión mensual de compras de bienes y servicios a la DGII.
            Cuando tu empresa esté formalizada (RNC y comprobantes fiscales), podrás generarlo aquí
            a partir de las facturas de Cuentas por Pagar.
          </p>
        </div>
      </div>
    );
  }

  const handleDownloadTxt = () => {
    const content = build606Txt(companyRnc, period, rows);
    download606Txt(dgii606FileName(companyRnc, period), content);
  };

  const csvColumns = [
    { header: 'Suplidor', value: (r: Dgii606Row) => r.invoice.supplier?.name ?? '' },
    ...DGII_606_HEADERS.map((h, i) => ({ header: h, value: (r: Dgii606Row) => r.fields[i] })),
  ];

  return (
    <div>
      <PageHeader title="Compras (Formato 606)">
        <div className="flex items-center gap-2">
          <ExportButton filename={`compras_606_${period.replace('-', '')}`} rows={rows} columns={csvColumns} />
          <Button onClick={handleDownloadTxt} disabled={rows.length === 0 || !companyRnc}>
            <FileDown className="mr-2 h-4 w-4" />
            TXT DGII
          </Button>
        </div>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="periodo-606">Período (mes)</Label>
          <Input
            id="periodo-606"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="w-[180px]"
          />
        </div>
        {!companyRnc && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            La empresa no tiene RNC configurado (Perfil de Empresa): se necesita para el archivo de envío.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registros del 606</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
            <p className="text-xs text-muted-foreground">Comprobantes del período {period}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Compras</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.compras)}</div>
            <p className="text-xs text-muted-foreground">Bienes + servicios facturados</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ITBIS Facturado</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.itbis)}</div>
            <p className="text-xs text-muted-foreground">
              Retenciones del período: {formatCurrency(totals.retenido)}
            </p>
          </CardContent>
        </Card>
      </div>

      {excluded.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300 mb-2">
            <FileWarning className="h-4 w-4" />
            {excluded.length} factura{excluded.length === 1 ? '' : 's'} del período excluida{excluded.length === 1 ? '' : 's'} del 606
          </div>
          <ul className="space-y-1 text-sm text-amber-800/90 dark:text-amber-300/90">
            {excluded.map((e) => (
              <li key={e.invoice.id}>
                {e.invoice.supplier?.name ?? 'Suplidor'} · {formatCurrency(e.invoice.total)} — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Suplidor</TableHead>
              {DGII_606_HEADERS.map((h) => (
                <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((r) => (
                <TableRow key={r.invoice.id}>
                  <TableCell className="whitespace-nowrap font-medium">{r.invoice.supplier?.name ?? '—'}</TableCell>
                  {r.fields.map((f, i) => (
                    <TableCell key={i} className="whitespace-nowrap">{f || '—'}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={DGII_606_HEADERS.length + 1} className="h-24 text-center">
                  No hay comprobantes con NCF en este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Valida el archivo TXT con la herramienta de pre-validación de la DGII antes de remitirlo por Oficina Virtual.
        Solo entran al 606 las facturas con NCF y suplidor con RNC/cédula válidos.
      </p>
    </div>
  );
}
