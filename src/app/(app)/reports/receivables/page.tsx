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
const DIA_MS = 24 * 60 * 60 * 1000;

export default function ReceivablesReportPage() {
  // `financingSales` ya trae solo las abiertas (crédito y financiamiento) e
  // incluye el pool compartido: con `sales` a secas el reporte se quedaba
  // corto en las empresas que cobran desde cualquier sucursal.
  const { financingSales } = useSales();
  const { profile } = useCompanyProfile();

  const rows = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return financingSales
      .filter((s) => !s.cancelledAt)
      .map((s) => {
        const st = calculateFinancingStatus(s, profile.lateFeeRate);
        // Días desde el vencimiento más viejo sin pagar: es el número por el
        // que se ordena una cartera, más que por el monto.
        const diasAtraso = st.isOverdue && st.nextDueDate
          ? Math.max(Math.floor((hoy.getTime() - st.nextDueDate.getTime()) / DIA_MS), 0)
          : 0;
        return {
          id: s.id,
          customer: s.customer?.name ?? 'Cliente',
          phone: s.customer?.phone ?? '',
          date: new Date(s.createdAt),
          type: s.paymentMethod === 'financing' ? 'Financiamiento' : 'Crédito',
          total: s.total,
          paid: s.amountPaid,
          pending: st.pendingBalance,
          lateFee: st.lateFee,
          overdue: st.isOverdue,
          diasAtraso,
        };
      })
      .filter((r) => r.pending > 0)
      .sort((a, b) => b.diasAtraso - a.diasAtraso || b.pending - a.pending);
  }, [financingSales, profile.lateFeeRate]);

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
            { header: 'Telefono', value: (r) => r.phone },
            { header: 'Fecha', value: (r) => r.date.toLocaleDateString('es-DO') },
            { header: 'Tipo', value: (r) => r.type },
            { header: 'Total', value: (r) => r.total },
            { header: 'Pagado', value: (r) => r.paid },
            { header: 'Pendiente', value: (r) => r.pending },
            { header: 'Mora', value: (r) => r.lateFee },
            { header: 'Dias de atraso', value: (r) => r.diasAtraso },
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
                  <TableHead>Teléfono</TableHead>
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
                    <TableCell className="whitespace-nowrap">{r.phone || '—'}</TableCell>
                    <TableCell>{r.date.toLocaleDateString('es-DO')}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.total)}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">{formatCurrency(r.pending)}</TableCell>
                    <TableCell className="text-right">{r.lateFee > 0 ? formatCurrency(r.lateFee) : '—'}</TableCell>
                    <TableCell>
                      {r.overdue ? (
                        <div className="flex flex-col">
                          <Badge variant="destructive" className="w-fit">Atrasado</Badge>
                          <span className="text-xs text-destructive mt-1">{r.diasAtraso} día{r.diasAtraso === 1 ? '' : 's'}</span>
                        </div>
                      ) : <Badge variant="outline">Al día</Badge>}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center">No hay cuentas por cobrar.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
