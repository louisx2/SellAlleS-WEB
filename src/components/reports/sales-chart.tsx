'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const chartConfig = {
  total: {
    label: 'Ventas',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

/** Cómo se dibuja la serie. Lo elige el usuario y se recuerda en localStorage. */
export type TipoGrafico = 'barras' | 'lineas' | 'area';

export const TIPOS_GRAFICO: { valor: TipoGrafico; etiqueta: string }[] = [
  { valor: 'barras', etiqueta: 'Barras' },
  { valor: 'lineas', etiqueta: 'Líneas' },
  { valor: 'area', etiqueta: 'Área' },
];

// Montos compactos en el eje (RD$1.5K / 2M) para no comerse la pantalla en móvil.
const compactCurrency = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
};

interface SalesChartProps {
  data: { name: string; total: number }[];
  tipo?: TipoGrafico;
  /** Rejilla de fondo. Ayuda a leer líneas y área; en barras suele estorbar. */
  rejilla?: boolean;
}

// ChartContainer ya envuelve en un ResponsiveContainer; no anidar otro (crecía
// pero no encogía → overflow horizontal en móvil).
export function SalesChart({ data, tipo = 'barras', rejilla }: SalesChartProps) {
  // Recharts localiza ejes, tooltip y marcas recorriendo sus HIJOS DIRECTOS por
  // tipo de componente. Por eso aquí se cambia el contenedor y se dejan los
  // hijos sueltos, en vez de agrupar los ejes en un fragmento: envueltos, los
  // ignoraría y el gráfico saldría sin ejes ni tooltip.
  const Contenedor = tipo === 'lineas' ? LineChart : tipo === 'area' ? AreaChart : BarChart;

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full min-w-0">
      <Contenedor data={data}>
        {tipo === 'area' && (
          <defs>
            <linearGradient id="rellenoTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.7} />
              <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
        )}
        {rejilla && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={42} tickFormatter={compactCurrency} />
        <ChartTooltip
          cursor={{ fill: 'hsl(var(--muted))' }}
          content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />}
        />
        {tipo === 'lineas' ? (
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-total)"
            strokeWidth={2}
            dot={data.length <= 31}
            activeDot={{ r: 5 }}
          />
        ) : tipo === 'area' ? (
          <Area
            type="monotone"
            dataKey="total"
            stroke="var(--color-total)"
            strokeWidth={2}
            fill="url(#rellenoTotal)"
          />
        ) : (
          <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
        )}
      </Contenedor>
    </ChartContainer>
  );
}
