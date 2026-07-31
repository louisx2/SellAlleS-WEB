'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { usePayables } from '@/context/payables-provider';
import { useExpenses } from '@/context/expense-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { useAuth } from '@/context/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { rowToCreditNote } from '@/lib/supabase/mappers';
import type { CreditNote } from '@/lib/types';
import { classify606 } from '@/lib/dgii-606';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/utils';
import { Receipt, DollarSign, Hash, ArrowUpCircle, ArrowDownCircle, Scale } from 'lucide-react';
import { ExportButton } from '@/components/reports/export-button';

// Período por defecto: el mes anterior (la IT-1 se declara el mes siguiente).
const defaultPeriod = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // yyyy-mm
};

export default function TaxesReportPage() {
  const { sales: salesRaw } = useSales();
  const { invoices } = usePayables();
  const { expenses } = useExpenses();
  const { profile } = useCompanyProfile();
  const { appUser } = useAuth();
  const [period, setPeriod] = useState(defaultPeriod());
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);

  // Las notas de crédito del período revierten ITBIS cobrado (igual que en el
  // 607) y se filtran por la sucursal activa, como las ventas y los gastos que
  // ya llegan filtrados de sus providers.
  const activeBranchId = appUser?.activeBranchId;
  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('credit_notes')
        .select('*, customers(name, rnc)')
        .or(`branch_id.eq.${activeBranchId},branch_id.is.null`)
        .order('created_at', { ascending: false });
      if (!cancelled) setCreditNotes((data ?? []).map(rowToCreditNote));
    })();
    return () => { cancelled = true; };
  }, [activeBranchId]);

  // Ventas del mes local. Se incluyen las que luego se anularon: el ITBIS se
  // cobró en su mes y su nota de crédito lo revierte en el mes de la NC.
  const periodSales = useMemo(
    () => salesRaw.filter((s) => format(s.createdAt, 'yyyy-MM') === period),
    [salesRaw, period]
  );
  const periodNotes = useMemo(
    () => creditNotes.filter((n) => format(n.createdAt, 'yyyy-MM') === period),
    [creditNotes, period]
  );

  const stats = useMemo(() => {
    const salesItbis = periodSales.reduce((a, s) => a + s.itbisAmount, 0);
    const salesRevenue = periodSales.reduce((a, s) => a + s.total, 0);
    const taxable = periodSales.filter((s) => s.itbisAmount > 0).length;
    const notesItbis = periodNotes.reduce((a, n) => a + n.itbisAmount, 0);
    return {
      salesRevenue,
      taxable,
      // ITBIS cobrado neto (operaciones − devoluciones): la parte "output" de la IT-1.
      outputItbis: salesItbis - notesItbis,
    };
  }, [periodSales, periodNotes]);

  // ITBIS adelantable en compras (casilla 15 del 606 del período). Reutiliza
  // classify606 para respetar el criterio "retención al pagar" y los gastos.
  const inputItbis = useMemo(() => {
    if (!profile.isFormalized) return 0;
    const periodInvoices = invoices.filter(
      (i) => i.issueDate?.startsWith(period) || i.paymentDate?.startsWith(period)
    );
    const periodExpenses = expenses.filter((e) => format(e.date, 'yyyy-MM') === period);
    const { rows } = classify606(periodInvoices, periodExpenses, period);
    return rows.reduce((a, r) => a + parseFloat(r.fields[14] || '0'), 0);
  }, [invoices, expenses, period, profile.isFormalized]);

  const balance = stats.outputItbis - inputItbis;
  const owed = balance > 0.005;

  const taxableSales = useMemo(() => periodSales.filter((s) => s.itbisAmount > 0), [periodSales]);

  return (
    <div>
      <PageHeader title="Impuestos (ITBIS / IT-1)">
        <ExportButton
          filename={`impuestos_itbis_${period.replace('-', '')}`}
          rows={taxableSales}
          columns={[
            { header: 'Fecha', value: (s) => new Date(s.createdAt).toLocaleString('es-DO') },
            { header: 'NCF', value: (s) => s.ncf ?? '' },
            { header: 'Cliente', value: (s) => s.customer?.name ?? '' },
            { header: 'Subtotal', value: (s) => s.subtotal },
            { header: 'ITBIS', value: (s) => s.itbisAmount },
            { header: 'Total', value: (s) => s.total },
          ]}
        />
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="periodo-itbis">Período (mes)</Label>
          <Input
            id="periodo-itbis"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="w-[180px]"
          />
        </div>
      </div>

      {/* Estimado IT-1: solo aplica a empresas formalizadas (declaran ITBIS). */}
      {profile.isFormalized && (
        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ITBIS Cobrado en Ventas</CardTitle>
              <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(stats.outputItbis)}</div>
              <p className="text-xs text-muted-foreground">Operaciones menos notas de crédito del mes</p>
            </CardContent>
          </Card>
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ITBIS Adelantable en Compras</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(inputItbis)}</div>
              <p className="text-xs text-muted-foreground">ITBIS por adelantar del 606 (facturas + gastos)</p>
            </CardContent>
          </Card>
          <Card className={owed ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{owed ? 'ITBIS a Pagar (est.)' : 'Saldo a Favor (est.)'}</CardTitle>
              <Scale className={owed ? 'h-4 w-4 text-amber-600' : 'h-4 w-4 text-emerald-600'} />
            </CardHeader>
            <CardContent>
              <div className={owed ? 'text-2xl font-bold text-amber-600' : 'text-2xl font-bold text-emerald-600'}>
                {formatCurrency(Math.abs(balance))}
              </div>
              <p className="text-xs text-muted-foreground">Cobrado − adelantable del período</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ITBIS Recaudado</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.outputItbis)}</div>
            <p className="text-xs text-muted-foreground">ITBIS neto de ventas del período {period}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos (Con ITBIS)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.salesRevenue)}</div>
            <p className="text-xs text-muted-foreground">Ingresos brutos del período</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ventas Gravadas</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.taxable}</div>
            <p className="text-xs text-muted-foreground">Transacciones con ITBIS en el período</p>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {profile.isFormalized ? (
          <>
            <span className="font-medium">Estimado preparatorio:</span> no sustituye la declaración IT-1. El ITBIS
            adelantable sale del 606 del período y no considera proporcionalidad especial, retenciones que te hicieron,
            ni arrastres de saldos a favor de meses anteriores. Confírmalo con tu contador antes de declarar.
          </>
        ) : (
          <>Este resumen muestra el ITBIS de tus ventas por mes. El estimado IT-1 (cobrado − adelantable) aparece cuando la empresa está formalizada en DGII.</>
        )}
      </p>
    </div>
  );
}
