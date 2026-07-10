import type { ChartType } from '@/components/dashboard/flex-chart';

// Catálogo de widgets del dashboard de negocio. Cada empresa/usuario elige
// cuáles ver y, en los visuales, con qué tipo de gráfico.
export type WidgetId =
  | 'kpi_revenue'
  | 'kpi_sales_count'
  | 'kpi_credit'
  | 'kpi_credit_tx'
  | 'chart_by_hour'
  | 'chart_by_branch'
  | 'recent_sales';

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  /** Tipos de gráfico disponibles; vacío = no configurable (KPI o tabla fija). */
  chartTypes?: ChartType[];
  defaultChart?: ChartType;
  adminOnly?: boolean;
}

export const DASHBOARD_WIDGETS: WidgetMeta[] = [
  { id: 'kpi_revenue', label: 'Ingresos de hoy (contado)' },
  { id: 'kpi_sales_count', label: 'Cantidad de ventas de hoy' },
  { id: 'kpi_credit', label: 'Crédito otorgado hoy' },
  { id: 'kpi_credit_tx', label: 'Transacciones a crédito' },
  { id: 'chart_by_hour', label: 'Ventas por hora', chartTypes: ['bar', 'line', 'table'], defaultChart: 'bar' },
  { id: 'chart_by_branch', label: 'Ventas por sucursal', chartTypes: ['bar', 'pie', 'table'], defaultChart: 'bar', adminOnly: true },
  { id: 'recent_sales', label: 'Últimas ventas de hoy' },
];

export interface DashboardConfig {
  visible: Record<WidgetId, boolean>;
  charts: Partial<Record<WidgetId, ChartType>>;
}

export function defaultDashboardConfig(): DashboardConfig {
  const visible = {} as Record<WidgetId, boolean>;
  const charts: Partial<Record<WidgetId, ChartType>> = {};
  for (const w of DASHBOARD_WIDGETS) {
    visible[w.id] = true;
    if (w.defaultChart) charts[w.id] = w.defaultChart;
  }
  return { visible, charts };
}

const keyFor = (companyId?: string, userId?: string) =>
  `dashboardConfig:${companyId ?? 'x'}:${userId ?? 'x'}`;

export function loadDashboardConfig(companyId?: string, userId?: string): DashboardConfig {
  const base = defaultDashboardConfig();
  if (typeof window === 'undefined') return base;
  try {
    const raw = localStorage.getItem(keyFor(companyId, userId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
    // Mezclar con defaults para tolerar widgets nuevos añadidos después.
    return {
      visible: { ...base.visible, ...(parsed.visible ?? {}) },
      charts: { ...base.charts, ...(parsed.charts ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveDashboardConfig(config: DashboardConfig, companyId?: string, userId?: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyFor(companyId, userId), JSON.stringify(config));
}
