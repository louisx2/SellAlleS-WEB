import Papa from 'papaparse';

// Exportador genérico de reportes a CSV. Cada reporte define sus columnas
// (encabezado visible + función que extrae el valor de cada fila) y llama a
// exportReportCsv con sus datos. BOM para que Excel respete acentos.
export interface ReportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

export function exportReportCsv<T>(filename: string, columns: ReportColumn<T>[], rows: T[]) {
  const data = rows.map((r) => {
    const obj: Record<string, string | number> = {};
    for (const col of columns) obj[col.header] = col.value(r);
    return obj;
  });
  const csv = Papa.unparse({ fields: columns.map((c) => c.header), data });
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
