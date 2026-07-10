'use client';

import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const chartConfig = {
  total: {
    label: 'Ventas',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

// Montos compactos en el eje (RD$1.5K / 2M) para no comerse la pantalla en móvil.
const compactCurrency = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

interface SalesChartProps {
  data: { name: string; total: number }[];
}

// ChartContainer ya envuelve en un ResponsiveContainer; no anidar otro (crecía
// pero no encogía → overflow horizontal en móvil).
export function SalesChart({ data }: SalesChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full min-w-0">
      <BarChart data={data}>
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={42} tickFormatter={compactCurrency} />
        <ChartTooltip
          cursor={{ fill: 'hsl(var(--muted))' }}
          content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />}
        />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
