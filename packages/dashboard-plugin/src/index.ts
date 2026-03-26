/**
 * @nexora-kit/dashboard-plugin
 *
 * Interactive dashboards from chat — conversational BI as a nexora-kit plugin.
 * This package exports tool handlers and the data source registry.
 *
 * Wiring: cmd-serve imports createDashboardToolHandlers(), passes the returned
 * Map to PluginLifecycleManager's toolHandlers option.
 */

import type { ToolHandler, ToolDispatcher } from '@nexora-kit/core';
import { DataSourceRegistry } from './data-sources/registry.js';
import type { DataSourceConfig } from './data-sources/types.js';
import { createListSourcesHandler } from './tools/list-sources.js';
import { createQueryHandler } from './tools/query.js';
import { createRenderChartHandler } from './tools/render-chart.js';
import { createDashboardCreateHandler } from './tools/create-dashboard.js';
import { createDashboardUpdateHandler } from './tools/update-dashboard.js';
import { createDashboardRefreshHandler } from './tools/refresh-dashboard.js';
import { createApplyFilterHandler } from './tools/apply-filter.js';
import { createCrossFilterHandler } from './tools/cross-filter.js';
import { buildDashboardContext } from './context/provider.js';

export interface DashboardPluginOptions {
  dataSources: DataSourceConfig[];
  /** Required when any data source uses type: 'tool'. */
  dispatcher?: ToolDispatcher;
  /** Namespace passed to ToolDispatcher.invoke() for tool-backed sources. */
  toolNamespace?: string;
}

export interface DashboardPlugin {
  toolHandlers: Map<string, ToolHandler>;
  registry: DataSourceRegistry;
  buildContext(): Promise<string>;
  close(): Promise<void>;
}

/**
 * Initialize the dashboard plugin and return tool handlers for registration.
 *
 * Call this before creating PluginLifecycleManager, then pass
 * the returned toolHandlers to the lifecycle options.
 */
export async function createDashboardPlugin(options: DashboardPluginOptions): Promise<DashboardPlugin> {
  const registry = new DataSourceRegistry(options.dispatcher, options.toolNamespace);

  // Register all configured data sources
  for (const dsConfig of options.dataSources) {
    await registry.register(dsConfig);
  }

  // Create tool handlers
  const toolHandlers = new Map<string, ToolHandler>();
  toolHandlers.set('dashboard_list_sources', createListSourcesHandler(registry));
  toolHandlers.set('dashboard_query', createQueryHandler(registry));
  toolHandlers.set('dashboard_render_chart', createRenderChartHandler(registry));
  toolHandlers.set('dashboard_create', createDashboardCreateHandler(registry));
  toolHandlers.set('dashboard_update', createDashboardUpdateHandler(registry));
  toolHandlers.set('dashboard_refresh', createDashboardRefreshHandler(registry));
  toolHandlers.set('dashboard_apply_filter', createApplyFilterHandler(registry));
  toolHandlers.set('dashboard_cross_filter', createCrossFilterHandler(registry));

  return {
    toolHandlers,
    registry,
    buildContext: () => buildDashboardContext(registry),
    close: () => registry.closeAll(),
  };
}

// Re-export types
export type { DataSourceConfig, DataSourceSchema, TabularResult, QueryConstraints } from './data-sources/types.js';
export { DataSourceRegistry } from './data-sources/registry.js';
export { ToolBackedAdapter } from './data-sources/tool-adapter.js';
export { ResultParserRegistry, parseToolResult } from './data-sources/result-parsers.js';
export { validateQuery } from './query/validator.js';
export { validateVegaLiteSpec } from './chart/validator.js';
export { buildDashboardContext } from './context/provider.js';

// Widget types and model
export type {
  DashboardWidget,
  ChartWidget,
  KpiWidget,
  TableWidget,
  FilterWidget,
  FilterField,
  WidgetQuery,
  GridSize,
} from './widgets/types.js';
export type { DashboardDefinition } from './widgets/dashboard-model.js';
export { createDashboardDefinition, serializeDashboard, parseDashboard } from './widgets/dashboard-model.js';

// Widget handlers
export { executeKpiWidget } from './widgets/kpi-handler.js';
export type { KpiBlockData, KpiResult } from './widgets/kpi-handler.js';
export { executeTableWidget } from './widgets/table-handler.js';
export type { TableBlockData, TableResult } from './widgets/table-handler.js';

// Dashboard tool handlers
export { createDashboardCreateHandler } from './tools/create-dashboard.js';
export { createDashboardUpdateHandler } from './tools/update-dashboard.js';
export { createDashboardRefreshHandler } from './tools/refresh-dashboard.js';
export { createApplyFilterHandler } from './tools/apply-filter.js';
export { createCrossFilterHandler } from './tools/cross-filter.js';
