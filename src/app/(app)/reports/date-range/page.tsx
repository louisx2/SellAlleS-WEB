
'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { PageHeader } from '@/components/page-header';
import type { Sale } from '@/lib/types';
import { SalesDataTable } from '@/components/sales/sales-data-table';
import { salesColumns } from '@/components/sales/sales-columns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { DollarSign, Hash } from 'lucide-react';
import { useSales } from '@/context/sales-provider';
import { ExportButton } from '@/components/reports/export-button';

export default function DateRangeReportPage() {
  const { sales: allSales } = useSales();
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [reportData, setReportData] = React.useState<Sale[]>([]);
  const [showResults, setShowResults] = React.useState(false);

  const handleGenerateReport = () => {
    if (date?.from && date.to) {
      // Set 'to' date to the end of the day to include all sales on that day
      const toDate = new Date(date.to);
      toDate.setHours(23, 59, 59, 999);

      const fromDate = new Date(date.from);
      fromDate.setHours(0, 0, 0, 0);

      const filteredSales = allSales.filter(sale => {
        const saleDate = new Date(sale.createdAt);
        return saleDate >= fromDate && saleDate <= toDate;
      });
      setReportData(filteredSales);
      setShowResults(true);
    }
  };

  const totalRevenue = reportData.reduce((acc, sale) => acc + sale.total, 0);
  const totalSalesCount = reportData.length;

  return (
    <div>
      <PageHeader title="Reporte de Ingresos por Fechas">
        {showResults && (
          <ExportButton
            filename="ingresos_por_fecha"
            rows={reportData}
            columns={[
              { header: 'Fecha', value: (s) => new Date(s.createdAt).toLocaleString('es-DO') },
              { header: 'Sucursal', value: (s) => s.branchId },
              { header: 'Cliente', value: (s) => s.customer?.name ?? '' },
              { header: 'NCF', value: (s) => s.ncf ?? '' },
              { header: 'Total', value: (s) => s.total },
              { header: 'Método', value: (s) => s.paymentMethod },
              { header: 'Estado', value: (s) => s.paymentStatus },
            ]}
          />
        )}
      </PageHeader>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className={cn('grid gap-2')}>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={'outline'}
                className={cn(
                  'w-full sm:w-[300px] justify-start text-left font-normal',
                  !date && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {format(date.from, 'LLL dd, y', { locale: es })} -{' '}
                      {format(date.to, 'LLL dd, y', { locale: es })}
                    </>
                  ) : (
                    format(date.from, 'LLL dd, y', { locale: es })
                  )
                ) : (
                  <span>Selecciona un rango</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={es}
              />
            </PopoverContent>
          </Popover>
        </div>
        <Button onClick={handleGenerateReport}>Generar Reporte</Button>
      </div>

      {showResults ? (
        <div className="mt-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Ingresos en Rango</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
                    <p className="text-xs text-muted-foreground">de {totalSalesCount} ventas</p>
                </CardContent>
                </Card>
                <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Ventas en Rango</CardTitle>
                    <Hash className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">+{totalSalesCount}</div>
                    <p className="text-xs text-muted-foreground">transacciones</p>
                </CardContent>
                </Card>
            </div>
            <SalesDataTable columns={salesColumns} data={reportData} />
        </div>
      ) : (
        <div className="mt-8">
            <p className="text-muted-foreground">
            Selecciona un rango de fechas y haz clic en "Generar Reporte" para ver los resultados.
            </p>
        </div>
      )}
    </div>
  );
}

    