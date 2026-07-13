'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { exportReportCsv, type ReportColumn } from '@/lib/report-export';

interface ExportButtonProps<T> {
  filename: string;
  columns: ReportColumn<T>[];
  rows: T[];
  label?: string;
}

export function ExportButton<T>({ filename, columns, rows, label = 'Exportar CSV' }: ExportButtonProps<T>) {
  return (
    <Button variant="outline" size="sm" onClick={() => exportReportCsv(filename, columns, rows)} disabled={rows.length === 0}>
      <Download className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}
