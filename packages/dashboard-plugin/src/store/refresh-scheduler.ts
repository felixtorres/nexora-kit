/**
 * RefreshScheduler — polls for dashboards due for refresh
 * and re-executes their widget queries.
 *
 * Supports both classic mode (JSON definitions) and app mode (HTML bundles).
 * For app mode, extracts the embedded AppDefinition, re-queries, and regenerates HTML.
 */

import type { DashboardStoreInterface } from './types.js';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { ChartWidget, KpiWidget, TableWidget } from '../widgets/types.js';
import { parseDashboard } from '../widgets/dashboard-model.js';
import { executeKpiWidget } from '../widgets/kpi-handler.js';
import { executeTableWidget } from '../widgets/table-handler.js';
import { generateApp } from '../app/generator.js';
import type { AppDefinition, WidgetDataMap } from '../app/types.js';
import { validateQuery } from '../query/validator.js';

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
          if (isAppModeHtml(dashboard.definition)) {
            await this.refreshAppDashboard(dashboard.id, dashboard.definition);
          } else {
            await this.refreshClassicDashboard(dashboard.id, dashboard.definition);
          }
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

  /** Classic mode: re-execute widget queries, cache results as JSON. */
  private async refreshClassicDashboard(id: string, definitionJson: string): Promise<void> {
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
        cachedWidgets.push({ widgetId: w.id, type: w.type, error: true });
      }
    }

    await this.store.update(id, {
      cachedResults: JSON.stringify(cachedWidgets),
      lastRefreshedAt: new Date().toISOString(),
    });
  }

  /** App mode: extract definition from HTML, re-query, regenerate HTML bundle. */
  private async refreshAppDashboard(id: string, html: string): Promise<void> {
    const appDef = extractAppDefinition(html);
    if (!appDef) {
      throw new Error('Cannot extract AppDefinition from stored HTML');
    }

    // Re-execute all widget queries
    const widgetData: WidgetDataMap = new Map();
    const queryWidgets = appDef.widgets.filter(
      w => w.type !== 'text' && 'query' in w && (w as any).query?.sql,
    );

    for (const widget of queryWidgets) {
      try {
        const query = (widget as any).query;
        const dsConfig = this.registry.getConfig(query.dataSourceId);
        const validation = validateQuery(query.sql, dsConfig.constraints);
        if (!validation.valid) continue; // Skip invalid queries silently during refresh
        const result = await this.registry.execute(query.dataSourceId, query.sql, query.params);
        widgetData.set(widget.id, result.rows);
      } catch {
        // Individual widget failure doesn't stop refresh
        widgetData.set(widget.id, []);
      }
    }

    // Regenerate the HTML bundle with fresh data
    const app = generateApp(appDef, widgetData);

    await this.store.update(id, {
      definition: app.html,
      lastRefreshedAt: new Date().toISOString(),
    });
  }
}

// --- Helpers ---

/** Check if a stored definition is an HTML bundle (app mode) vs JSON (classic). */
function isAppModeHtml(definition: string): boolean {
  const trimmed = definition.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');
}

/**
 * Extract the embedded AppDefinition from a generated HTML bundle.
 * The definition is stored in a `<script type="application/json" id="__APP_DEFINITION__">` tag.
 */
export function extractAppDefinition(html: string): AppDefinition | null {
  const startTag = '<script type="application/json" id="__APP_DEFINITION__">';
  const endTag = '</script>';
  const startIdx = html.indexOf(startTag);
  if (startIdx === -1) return null;
  const jsonStart = startIdx + startTag.length;
  const endIdx = html.indexOf(endTag, jsonStart);
  if (endIdx === -1) return null;

  try {
    const json = html.slice(jsonStart, endIdx).replace(/<\\\//g, '</');
    return JSON.parse(json) as AppDefinition;
  } catch {
    return null;
  }
}
