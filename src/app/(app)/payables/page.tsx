'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { usePayables } from '@/context/payables-provider';
import { useCompanyProfile } from '@/context/company-profile-provider';
import { PayablesDataTable } from '@/components/payables/payables-data-table';
import { buildPayableColumns } from '@/components/payables/payable-columns';
import { PayableInvoiceDialog } from '@/components/payables/payable-invoice-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle, AlertTriangle, CalendarClock, Wallet } from 'lucide-react';

type Filter = 'open' | 'all' | 'paid';

export default function PayablesPage() {
  const { invoices } = usePayables();
  const { profile } = useCompanyProfile();
  const showFiscal = profile.isFormalized;
  const [filter, setFilter] = useState<Filter>('open');

  const columns = useMemo(() => buildPayableColumns(showFiscal), [showFiscal]);

  const { totalPending, totalOverdue, dueSoon } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const in7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    let totalPending = 0, totalOverdue = 0, dueSoon = 0;
    for (const inv of invoices) {
      if (inv.balance <= 0) continue;
      totalPending += inv.balance;
      if (inv.dueDate && inv.dueDate < todayStr) totalOverdue += inv.balance;
      else if (inv.dueDate && inv.dueDate <= in7) dueSoon += inv.balance;
    }
    return { totalPending, totalOverdue, dueSoon };
  }, [invoices]);

  const filtered = useMemo(() => {
    if (filter === 'open') return invoices.filter((i) => i.status !== 'paid');
    if (filter === 'paid') return invoices.filter((i) => i.status === 'paid');
    return invoices;
  }, [invoices, filter]);

  return (
    <div>
      <PageHeader title="Cuentas por Pagar">
        <PayableInvoiceDialog>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Registrar Factura
          </Button>
        </PayableInvoiceDialog>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total por Pagar</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalPending)}</div>
            <p className="text-xs text-muted-foreground">Balance pendiente con suplidores</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencido</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatCurrency(totalOverdue)}</div>
            <p className="text-xs text-muted-foreground">Facturas pasadas de su vencimiento</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Por Vencer (7 días)</CardTitle>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dueSoon)}</div>
            <p className="text-xs text-muted-foreground">Vencen en la próxima semana</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="open">Pendientes</TabsTrigger>
          <TabsTrigger value="paid">Pagadas</TabsTrigger>
          <TabsTrigger value="all">Todas</TabsTrigger>
        </TabsList>
      </Tabs>

      <PayablesDataTable columns={columns} data={filtered} showNcfFilter={showFiscal} />
    </div>
  );
}
