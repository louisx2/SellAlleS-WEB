'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportButton } from '@/components/reports/export-button';
import { useSales } from '@/context/sales-provider';
import { useLoans } from '@/context/loan-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { calculateFinancingStatus, formatCurrency } from '@/lib/utils';
import { calculateLoanStatus } from '@/lib/loan-utils';
import { agruparCartera, TRAMOS, type CuentaCartera } from '@/lib/antiguedad';
import { AlertTriangle, Users, Wallet } from 'lucide-react';

// Antigüedad de cartera: lo que se debe por cliente en tramos de días de
// atraso, sumando préstamos, financiamientos y crédito simple. Los días salen
// de la cuota vencida más vieja, igual que en Cuentas por Cobrar.
const DIA_MS = 24 * 60 * 60 * 1000;

function diasDesde(fecha: Date | null, atrasado: boolean, hoy: Date): number {
  if (!atrasado || !fecha) return 0;
  return Math.max(Math.floor((hoy.getTime() - fecha.getTime()) / DIA_MS), 0);
}

export default function AntiguedadCarteraPage() {
  const { financingSales } = useSales();
  const { loans } = useLoans();
  const { profile } = useCompanyProfile();

  const { filas, totales } = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const cuentas: CuentaCartera[] = [];

    for (const s of financingSales) {
      if (s.cancelledAt) continue;
      const st = calculateFinancingStatus(s, profile.lateFeeRate, profile.lateFeeGraceDays);
      // Crédito simple: no hay cuotas ni fecha de vencimiento que medir.
      const sinPlan = !s.financingDetails && !(s.installments?.length);
      cuentas.push({
        id: s.id,
        tipo: s.paymentMethod === 'financing' ? 'financiamiento' : 'credito',
        clienteId: s.customerId ?? s.customer?.id ?? s.id,
        cliente: s.customer?.name ?? 'Cliente',
        telefono: s.customer?.phone ?? '',
        saldo: st.pendingBalance,
        diasAtraso: sinPlan ? null : diasDesde(st.nextDueDate, st.isOverdue, hoy),
      });
    }

    for (const l of loans) {
      if (l.status !== 'active') continue;
      const st = calculateLoanStatus(l, profile.loanLateFeeRate, profile.loanLateFeeGraceDays);
      cuentas.push({
        id: l.id,
        tipo: 'prestamo',
        clienteId: l.customerId,
        cliente: l.customer?.name ?? 'Cliente',
        telefono: l.customer?.phone ?? '',
        saldo: st.pendingBalance,
        diasAtraso: diasDesde(st.nextDueDate, st.isOverdue, hoy),
      });
    }

    return agruparCartera(cuentas);
  }, [financingSales, loans, profile.lateFeeRate, profile.lateFeeGraceDays, profile.loanLateFeeRate, profile.loanLateFeeGraceDays]);

  const atrasados = filas.filter((f) => f.diasMax > 0).length;
  const pctVencido = totales.total > 0 ? Math.round((totales.vencido / totales.total) * 1000) / 10 : 0;

  return (
    <div>
      <PageHeader title="Antigüedad de Cartera">
        <ExportButton
          filename="antiguedad_cartera"
          rows={filas}
          columns={[
            { header: 'Cliente', value: (f) => f.cliente },
            { header: 'Telefono', value: (f) => f.telefono },
            ...TRAMOS.map((t) => ({ header: t.label, value: (f: (typeof filas)[number]) => f.porTramo[t.key] })),
            { header: 'Sin plan', value: (f) => f.sinPlan },
            { header: 'Total', value: (f) => f.total },
            { header: 'Dias de atraso', value: (f) => f.diasMax },
          ]}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cartera total</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totales.total)}</div>
            <p className="text-xs text-muted-foreground">{filas.length} {filas.length === 1 ? 'cliente' : 'clientes'} con saldo</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencido</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totales.vencido)}</div>
            <p className="text-xs text-muted-foreground">{pctVencido}% de la cartera</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes atrasados</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{atrasados}</div>
            <p className="text-xs text-muted-foreground">con al menos una cuota vencida</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Por cliente</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  {TRAMOS.map((t) => <TableHead key={t.key} className="text-right whitespace-nowrap">{t.label}</TableHead>)}
                  <TableHead className="text-right whitespace-nowrap">Sin plan</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length > 0 ? filas.map((f) => (
                  <TableRow key={f.clienteId}>
                    <TableCell>
                      <p className="font-medium">{f.cliente}</p>
                      {f.telefono && <p className="text-xs text-muted-foreground whitespace-nowrap">{f.telefono}</p>}
                    </TableCell>
                    {TRAMOS.map((t) => (
                      <TableCell key={t.key} className={`text-right whitespace-nowrap ${t.key !== 'al_dia' && f.porTramo[t.key] > 0 ? 'text-destructive' : ''}`}>
                        {f.porTramo[t.key] > 0 ? formatCurrency(f.porTramo[t.key]) : '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-right whitespace-nowrap">{f.sinPlan > 0 ? formatCurrency(f.sinPlan) : '—'}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(f.total)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={TRAMOS.length + 3} className="text-center text-muted-foreground">
                      No hay cuentas con saldo pendiente.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {filas.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    {TRAMOS.map((t) => (
                      <TableCell key={t.key} className="text-right font-semibold whitespace-nowrap">{formatCurrency(totales[t.key])}</TableCell>
                    ))}
                    <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(totales.sinPlan)}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(totales.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
