'use client';

import {
  Bar, BarChart, Line, LineChart, Pie, PieChart, Cell, XAxis, YAxis,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';

export type ChartType = 'bar' | 'line' | 'pie' | 'table';

const config = { total: { label: 'Total', color: 'hsl(var(--primary))' } } satisfies ChartConfig;

// Paleta para el gráfico de círculo (colores de gráficas del tema).
const PIE_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--primary))',
];

const compact = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
};

interface FlexChartProps {
  type: ChartType;
  data: { name: string; total: number }[];
  /** true = formatear valores como moneda (RD$). */
  currency?: boolean;
}

// Un mismo conjunto de datos {name,total} renderizado como barras, línea,
// círculo o tabla según lo elija el usuario en la configuración del dashboard.
export function FlexChart({ type, data, currency = true }: FlexChartProps) {
  const fmt = (v: number) => (currency ? formatCurrency(v) : String(v));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">Sin datos para mostrar.</p>;
  }

  if (type === 'table') {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((d) => (
              <TableRow key={d.name}>
                <TableCell>{d.name}</TableCell>
                <TableCell className="text-right font-medium">{fmt(d.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (type === 'pie') {
    return (
      <ChartContainer config={config} className="h-[300px] w-full min-w-0">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmt(Number(v))} />} />
          <Pie data={data} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  if (type === 'line') {
    return (
      <ChartContainer config={config} className="h-[300px] w-full min-w-0">
        <LineChart data={data}>
          <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={42} tickFormatter={currency ? compact : undefined} />
          <ChartTooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltipContent formatter={(v) => fmt(Number(v))} />} />
          <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    );
  }

  // bar (default)
  return (
    <ChartContainer config={config} className="h-[300px] w-full min-w-0">
      <BarChart data={data}>
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={42} tickFormatter={currency ? compact : undefined} />
        <ChartTooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltipContent formatter={(v) => fmt(Number(v))} />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
