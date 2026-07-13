'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, calculateFinancingStatus } from '@/lib/utils';
import { useSales } from '@/context/sales-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { ExportButton } from '@/components/reports/export-button';
import { CreditCard, AlertTriangle, Wallet } from 'lucide-react';

// Reporte de Cuentas por Cobrar: consolida ventas a crédito y financiadas con
// su saldo pendiente y mora. Reutiliza calculateFinancingStatus (mismo cálculo
// que la pantalla de financiamiento).
export default function ReceivablesReportPage() {
  const { sales } = useSales();
  const { profile } = useCompanyProfile();

  const rows = useMemo(() => {
    return sales
      .filter((s) => s.paymentStatus === 'credit' || s.paymentStatus === 'in_financing')
      .map((s) => {
        const st = calculateFinancingStatus(s, profile.lateFeeRate);
        return {
          id: s.id,
          customer: s.customer?.name ?? 'Cliente',
          date: new Date(s.createdAt),
          type: s.paymentMethod === 'financing' ? 'Financiamiento' : 'Crédito',
          total: s.total,
          paid: s.amountPaid,
          pending: st.pendingBalance,
          lateFee: st.lateFee,
          overdue: st.isOverdue,
        };
      })
      .filter((r) => r.pending > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [sales, profile.lateFeeRate]);

  const totals = useMemo(() => ({
    pending: rows.reduce((a, r) => a + r.pending, 0),
    lateFee: rows.reduce((a, r) => a + r.lateFee, 0),
    overdue: rows.filter((r) => r.overdue).length,
  }), [rows]);

  return (
    <div>
      <PageHeader title="Cuentas por Cobrar">
        <ExportButton
          filename="cuentas_por_cobrar"
          rows={rows}
          columns={[
            { header: 'Cliente', value: (r) => r.customer },
            { header: 'Fecha', value: (r) => r.date.toLocaleDateString('es-DO') },
            { header: 'Tipo', value: (r) => r.type },
            { header: 'Total', value: (r) => r.total },
            { header: 'Pagado', value: (r) => r.paid },
            { header: 'Pendiente', value: (r) => r.pending },
            { header: 'Mora', value: (r) => r.lateFee },
            { header: 'Estado', value: (r) => (r.overdue ? 'Atrasado' : 'Al día') },
          ]}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total por cobrar</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.pending)}</div>
            <p className="text-xs text-muted-foreground">{rows.length} cuentas abiertas</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mora exigible</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totals.lateFee)}</div>
            <p className="text-xs text-muted-foreground">de cuotas vencidas</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cuentas atrasadas</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.overdue}</div>
            <p className="text-xs text-muted-foreground">requieren seguimiento</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Detalle</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Mora</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customer}</TableCell>
                    <TableCell>{r.date.toLocaleDateString('es-DO')}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.total)}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">{formatCurrency(r.pending)}</TableCell>
                    <TableCell className="text-right">{r.lateFee > 0 ? formatCurrency(r.lateFee) : '—'}</TableCell>
                    <TableCell>{r.overdue ? <Badge variant="destructive">Atrasado</Badge> : <Badge variant="outline">Al día</Badge>}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">No hay cuentas por cobrar.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
