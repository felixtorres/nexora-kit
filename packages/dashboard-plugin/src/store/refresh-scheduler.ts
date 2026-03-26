/**
 * RefreshScheduler — polls for dashboards due for refresh
 * and re-executes their widget queries.
 *
 * Runs as a background interval. Cached results are stored
 * on the dashboard for serving to shared/anonymous views.
 */

import type { DashboardStoreInterface } from './types.js';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { ChartWidget, KpiWidget, TableWidget } from '../widgets/types.js';
import { parseDashboard, serializeDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';

export interface RefreshSchedulerOptions {
  store: DashboardStoreInterface;
  registry: DataSourceRegistry;
  pollIntervalMs?: number;
  onError?: (dashboardId: string, error: Error) => void;
}

export class RefreshScheduler {
  private readonly store: DashboardStoreInterface;
  private readonly registry: DataSourceRegistry;
  private readonly pollIntervalMs: number;
  private readonly onError?: (dashboardId: string, error: Error) => void;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(options: RefreshSchedulerOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000; // 1 minute default poll
    this.onError = options.onError;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one refresh cycle — exposed for testing. */
  async tick(): Promise<number> {
    if (this.running) return 0; // Skip if previous tick is still running
    this.running = true;

    let refreshed = 0;
    try {
      const due = await this.store.listDueForRefresh();
      for (const dashboard of due) {
        try {
          await this.refreshDashboard(dashboard.id, dashboard.definition);
          refreshed++;
        } catch (error) {
          this.onError?.(dashboard.id, error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.running = false;
    }
    return refreshed;
  }

  private async refreshDashboard(id: string, definitionJson: string): Promise<void> {
    const def = parseDashboard(definitionJson);
    const cachedWidgets: Record<string, unknown>[] = [];

    for (const w of def.widgets) {
      try {
        switch (w.type) {
          case 'chart': {
            const chart = w as ChartWidget;
            const result = await this.registry.execute(
              chart.query.dataSourceId,
              chart.query.sql ?? '',
              chart.query.params,
            );
            cachedWidgets.push({
              widgetId: w.id,
              type: 'chart',
              data: result.rows,
              columns: result.columns,
              rowCount: result.rowCount,
            });
            break;
          }
          case 'kpi': {
            const kpiBlock = await executeKpiWidget(w as KpiWidget, this.registry);
            cachedWidgets.push({ widgetId: w.id, type: 'kpi', data: kpiBlock.data });
            break;
          }
          case 'table': {
            const tableBlock = await executeTableWidget(w as TableWidget, this.registry);
            cachedWidgets.push({ widgetId: w.id, type: 'table', data: tableBlock.data });
            break;
          }
        }
      } catch {
        // Individual widget failure doesn't stop the refresh
        cachedWidgets.push({ widgetId: w.id, type: w.type, error: true });
      }
    }

    await this.store.update(id, {
      cachedResults: JSON.stringify(cachedWidgets),
      lastRefreshedAt: new Date().toISOString(),
    });
  }
}
