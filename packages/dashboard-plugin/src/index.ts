/**
 * @nexora-kit/dashboard-plugin
 *
 * Interactive dashboards from chat — conversational BI as a nexora-kit plugin.
 * This package exports tool handlers and the data source registry.
 *
 * Wiring: cmd-serve imports createDashboardToolHandlers(), passes the returned
 * Map to PluginLifecycleManager's toolHandlers option.
 */

import type { ToolHandler } from '@nexora-kit/core';
import { DataSourceRegistry } from './data-sources/registry.js';
import type { DataSourceConfig } from './data-sources/types.js';
import { createListSourcesHandler } from './tools/list-sources.js';
import { createQueryHandler } from './tools/query.js';
import { createRenderChartHandler } from './tools/render-chart.js';
import { buildDashboardContext } from './context/provider.js';

export interface DashboardPluginOptions {
  dataSources: DataSourceConfig[];
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
  const registry = new DataSourceRegistry();

  // Register all configured data sources
  for (const dsConfig of options.dataSources) {
    await registry.register(dsConfig);
  }

  // Create tool handlers
  const toolHandlers = new Map<string, ToolHandler>();
  toolHandlers.set('dashboard_list_sources', createListSourcesHandler(registry));
  toolHandlers.set('dashboard_query', createQueryHandler(registry));
  toolHandlers.set('dashboard_render_chart', createRenderChartHandler(registry));

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
export { validateQuery } from './query/validator.js';
export { validateVegaLiteSpec } from './chart/validator.js';
export { buildDashboardContext } from './context/provider.js';
