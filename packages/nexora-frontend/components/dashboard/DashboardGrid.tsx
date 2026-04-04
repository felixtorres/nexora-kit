'use client';

import { ChartWidget } from './ChartWidget';
import { KpiCard } from './KpiCard';
import { DataTable } from './DataTable';
import type { ChartWidgetData } from './ChartWidget';
import type { KpiCardData } from './KpiCard';
import type { DataTableData } from './DataTable';

interface GridSize {
  col: number;
  row: number;
  width: number;
  height: number;
}

/**
 * Grid widget as sent by the dashboard backend.
 * `type` is the short kind ('chart' | 'kpi' | 'table') — NOT prefixed.
 * `rendered` holds the widget-specific data (spec, rows, value, etc.).
 * `size` is the grid placement.
 */
interface GridWidget {
  widgetId?: string;
  type: string;
  size?: GridSize;
  rendered?: Record<string, unknown>;
  /** Legacy: some code paths put widget data here instead of `rendered`. */
  data?: Record<string, unknown> & { size?: GridSize };
}

export interface DashboardGridData {
  dashboardId: string;
  title: string;
  widgets: GridWidget[];
}

interface DashboardGridProps {
  data: DashboardGridData;
  onAction?: (actionId: string, payload: Record<string, unknown>) => void;
}

/** Normalize short type ('chart') and prefixed type ('custom:dashboard/chart') */
function resolveWidgetType(type: string): string {
  if (type.startsWith('custom:')) return type;
  return `custom:dashboard/${type}`;
}

/** Get the widget-specific data from whichever field the backend used. */
function resolveWidgetData(widget: GridWidget): Record<string, unknown> {
  return widget.rendered ?? widget.data ?? {};
}

function WidgetRenderer({ widget }: { widget: GridWidget }) {
  const data = resolveWidgetData(widget);
  switch (resolveWidgetType(widget.type)) {
    case 'custom:dashboard/chart':
      return <ChartWidget data={data as unknown as ChartWidgetData} />;
    case 'custom:dashboard/kpi':
      return <KpiCard data={data as unknown as KpiCardData} />;
    case 'custom:dashboard/table':
      return <DataTable data={data as unknown as DataTableData} />;
    default:
      return (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Unknown widget type: {widget.type}
        </div>
      );
  }
}

export function DashboardGrid({ data, onAction }: DashboardGridProps) {
  const handleRefresh = () => {
    onAction?.('dashboard-refresh', { dashboardId: data.dashboardId });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
        <button
          onClick={handleRefresh}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Refresh all widgets"
        >
          ↻ Refresh
        </button>
      </div>
      <div
        className="grid gap-4 max-sm:grid-cols-1"
        style={{
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        }}
      >
        {data.widgets.map((widget, i) => {
          // size can be top-level (backend grid format) or inside data (legacy)
          const size = (widget.size ?? widget.data?.size) as GridSize | undefined;

          // When size is provided, place widget on the explicit grid position.
          // Otherwise, let it auto-flow spanning full width.
          const style: React.CSSProperties = size
            ? {
                gridColumn: `${size.col} / span ${size.width}`,
                gridRow: `${size.row} / span ${size.height}`,
              }
            : { gridColumn: '1 / -1' };

          const key = widget.widgetId ?? (widget.data?.widgetId as string) ?? i;

          return (
            <div key={key} style={style}>
              <WidgetRenderer widget={widget} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
