'use client';

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';

const salesConfig = {
  total: { label: 'Ventas', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

const growthConfig = {
  nuevas: { label: 'Empresas nuevas', color: 'hsl(var(--primary))' },
} satisfies ChartConfig;

export function PlatformSalesChart({ data }: { data: { name: string; total: number }[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Ventas de la Plataforma</CardTitle>
        <CardDescription>Volumen diario de todos los tenants — últimos 14 días.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={salesConfig} className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={80}
                tickFormatter={(value) => formatCurrency(value)}
              />
              <ChartTooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />}
              />
              <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function CompaniesGrowthChart({ data }: { data: { name: string; nuevas: number }[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Crecimiento de Empresas</CardTitle>
        <CardDescription>Altas por mes — últimos 6 meses.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={growthConfig} className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <ChartTooltip
                cursor={{ fill: 'hsl(var(--muted))' }}
                content={<ChartTooltipContent />}
              />
              <Bar dataKey="nuevas" fill="var(--color-nuevas)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
