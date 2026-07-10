'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSales } from '@/context/sales-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Receipt, DollarSign, Hash } from 'lucide-react';
import { ExportButton } from '@/components/reports/export-button';

export default function TaxesReportPage() {
  const { sales } = useSales();

  const { totalItbis, totalRevenue, totalTaxableSales } = useMemo(() => {
    return sales.reduce(
      (acc, sale) => {
        acc.totalItbis += sale.itbisAmount;
        acc.totalRevenue += sale.total;
        if (sale.itbisAmount > 0) {
          acc.totalTaxableSales += 1;
        }
        return acc;
      },
      {
        totalItbis: 0,
        totalRevenue: 0,
        totalTaxableSales: 0,
      }
    );
  }, [sales]);

  const taxableSales = useMemo(() => sales.filter((s) => s.itbisAmount > 0), [sales]);

  return (
    <div>
      <PageHeader title="Reporte de Impuestos">
        <ExportButton
          filename="impuestos_itbis"
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ITBIS Recaudado (Total)</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalItbis)}</div>
            <p className="text-xs text-muted-foreground">
              Total de ITBIS de todas las ventas
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos Totales (Con ITBIS)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              Ingresos brutos incluyendo impuestos
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ventas Gravadas</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+{totalTaxableSales}</div>
            <p className="text-xs text-muted-foreground">
              Transacciones con al menos un item gravado
            </p>
          </CardContent>
        </Card>
      </div>
       <div className="mt-8 text-center text-muted-foreground">
            <p>Este es un reporte preliminar. La funcionalidad completa de reportes fiscales estará disponible próximamente.</p>
       </div>
    </div>
  );
}

    