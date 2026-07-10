'use client';

import { Bar, BarChart, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';

const salesConfig = {
  total: { label: 'Ventas', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

const growthConfig = {
  nuevas: { label: 'Empresas nuevas', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

// OJO: ChartContainer ya envuelve a sus hijos en un ResponsiveContainer de
// recharts — anidar otro hacía que la gráfica solo pudiera crecer y nunca
// encogerse, desbordando la pantalla en móvil (scroll lateral).
// min-w-0/overflow-hidden completan el fix dentro del grid.

// Compacta los montos del eje Y (RD$1.5K, RD$2M) para que el eje no se coma
// media pantalla en móvil como pasaba con formatCurrency completo.
const compactCurrency = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

export function PlatformSalesChart({ data }: { data: { name: string; total: number }[] }) {
  return (
    <Card className="shadow-sm min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Ventas de la Plataforma</CardTitle>
        <CardDescription>Volumen diario de todos los tenants — últimos 14 días.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={salesConfig} className="h-[240px] w-full">
          <BarChart data={data}>
            <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#888888"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={42}
              tickFormatter={compactCurrency}
            />
            <ChartTooltip
              cursor={{ fill: 'hsl(var(--muted))' }}
              content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />}
            />
            <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function CompaniesGrowthChart({ data }: { data: { name: string; nuevas: number }[] }) {
  return (
    <Card className="shadow-sm min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Crecimiento de Empresas</CardTitle>
        <CardDescription>Altas por mes — últimos 6 meses.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={growthConfig} className="h-[240px] w-full">
          <BarChart data={data}>
            <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
            <ChartTooltip
              cursor={{ fill: 'hsl(var(--muted))' }}
              content={<ChartTooltipContent />}
            />
            <Bar dataKey="nuevas" fill="var(--color-nuevas)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
