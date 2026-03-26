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

interface RenderedWidget {
  type: string;
  data: Record<string, unknown> & { size?: GridSize };
}

export interface DashboardGridData {
  dashboardId: string;
  title: string;
  widgets: RenderedWidget[];
}

interface DashboardGridProps {
  data: DashboardGridData;
}

function WidgetRenderer({ widget }: { widget: RenderedWidget }) {
  switch (widget.type) {
    case 'custom:dashboard/chart':
      return <ChartWidget data={widget.data as unknown as ChartWidgetData} />;
    case 'custom:dashboard/kpi':
      return <KpiCard data={widget.data as unknown as KpiCardData} />;
    case 'custom:dashboard/table':
      return <DataTable data={widget.data as unknown as DataTableData} />;
    default:
      return (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Unknown widget type: {widget.type}
        </div>
      );
  }
}

export function DashboardGrid({ data }: DashboardGridProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
      <div
        className="grid gap-4 max-sm:grid-cols-1"
        style={{
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        }}
      >
        {data.widgets.map((widget, i) => {
          const size = widget.data.size as GridSize | undefined;

          // When size is provided, place widget on the explicit grid position.
          // Otherwise, let it auto-flow spanning full width.
          const style: React.CSSProperties = size
            ? {
                gridColumn: `${size.col} / span ${size.width}`,
                gridRow: `${size.row} / span ${size.height}`,
              }
            : { gridColumn: '1 / -1' };

          return (
            <div key={(widget.data.widgetId as string) ?? i} style={style}>
              <WidgetRenderer widget={widget} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
