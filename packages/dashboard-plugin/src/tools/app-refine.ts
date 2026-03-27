/**
 * dashboard:app_refine tool handler.
 *
 * Modifies an existing dashboard app by adding, removing, or updating widgets.
 * Supports three refinement levels:
 *   - 'layout'    (r0): Layout/theme changes only, no query re-execution
 *   - 'dashboard' (r1): Add/remove widgets, re-execute all affected queries
 *   - 'widget'    (r2): Update a single widget, re-execute only that query
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  AppDefinition,
  AppWidget,
  AppChartWidget,
  WidgetDataMap,
} from '../app/types.js';
import { DEFAULT_APP_LAYOUT, VALID_ECHART_TYPES } from '../app/types.js';
import { normalizeEChartsConfig } from '../chart/echarts-validator.js';
import { validateQuery } from '../query/validator.js';
import { generateApp } from '../app/generator.js';

export function createAppRefineHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const appId = input.appId as string;
    const definitionJson = input.definition as string;
    const refinementLevel = (input.refinementLevel as string) || 'dashboard';
    const addWidgetsJson = input.addWidgets as string | undefined;
    const removeWidgetIdsJson = input.removeWidgetIds as string | undefined;
    const updateWidgetsJson = input.updateWidgets as string | undefined;
    const newTitle = input.title as string | undefined;
    const newTheme = input.theme as string | undefined;

    // --- Validation ---
    if (!appId) return 'Error: appId is required';
    if (!definitionJson) return 'Error: definition is required (current AppDefinition JSON)';
    if (!['layout', 'dashboard', 'widget'].includes(refinementLevel)) {
      return `Error: refinementLevel must be 'layout', 'dashboard', or 'widget'`;
    }

    // Parse current definition
    let def: AppDefinition;
    try {
      const parsed = typeof definitionJson === 'string'
        ? JSON.parse(definitionJson)
        : definitionJson;
      def = parsed as AppDefinition;
    } catch {
      return 'Error: definition must be valid JSON';
    }

    if (!def.widgets || !Array.isArray(def.widgets)) {
      return 'Error: definition.widgets must be an array';
    }

    // --- Apply changes ---
    const affectedWidgetIds = new Set<string>();

    // Apply title change
    if (newTitle) def.title = newTitle;

    // Apply theme change
    if (newTheme && ['light', 'dark', 'auto'].includes(newTheme)) {
      def.theme = newTheme as 'light' | 'dark' | 'auto';
    }

    // Remove widgets
    if (removeWidgetIdsJson) {
      let removeIds: string[];
      try {
        const parsed = typeof removeWidgetIdsJson === 'string'
          ? JSON.parse(removeWidgetIdsJson)
          : removeWidgetIdsJson;
        if (!Array.isArray(parsed)) return 'Error: removeWidgetIds must be a JSON array';
        removeIds = parsed as string[];
      } catch {
        return 'Error: removeWidgetIds must be valid JSON';
      }
      const removeSet = new Set(removeIds);
      def.widgets = def.widgets.filter(w => !removeSet.has(w.id));
    }

    // Update widgets (merge partial updates)
    if (updateWidgetsJson) {
      let updates: Partial<AppWidget>[];
      try {
        const parsed = typeof updateWidgetsJson === 'string'
          ? JSON.parse(updateWidgetsJson)
          : updateWidgetsJson;
        if (!Array.isArray(parsed)) return 'Error: updateWidgets must be a JSON array';
        updates = parsed as Partial<AppWidget>[];
      } catch {
        return 'Error: updateWidgets must be valid JSON';
      }

      for (const update of updates) {
        const w = update as unknown as Record<string, unknown>;
        if (!w.id) return 'Error: each widget update must include an id';
        const idx = def.widgets.findIndex(existing => existing.id === w.id);
        if (idx === -1) return `Error: widget '${w.id}' not found`;
        def.widgets[idx] = { ...def.widgets[idx], ...update } as AppWidget;
        affectedWidgetIds.add(w.id as string);
      }
    }

    // Add new widgets
    if (addWidgetsJson) {
      let newWidgets: AppWidget[];
      try {
        const parsed = typeof addWidgetsJson === 'string'
          ? JSON.parse(addWidgetsJson)
          : addWidgetsJson;
        if (!Array.isArray(parsed)) return 'Error: addWidgets must be a JSON array';
        newWidgets = parsed as AppWidget[];
      } catch {
        return 'Error: addWidgets must be valid JSON';
      }

      for (const w of newWidgets) {
        const rec = w as unknown as Record<string, unknown>;
        if (!rec.id || !rec.type) return 'Error: new widget missing id or type';
        if (def.widgets.some(existing => existing.id === w.id)) {
          return `Error: widget ID '${w.id}' already exists`;
        }

        // Validate chart widgets
        if (w.type === 'chart') {
          const chart = w as AppChartWidget;
          if (!VALID_ECHART_TYPES.has(chart.chartType)) {
            return `Error: invalid chartType '${chart.chartType}'`;
          }
          const result = normalizeEChartsConfig(chart.config, chart.chartType);
          if (typeof result === 'string') return `Widget '${w.id}': ${result}`;
          chart.config = result.config;
        }

        def.widgets.push(w);
        affectedWidgetIds.add(w.id);
      }
    }

    if (def.widgets.length === 0) {
      return 'Error: cannot remove all widgets — dashboard must have at least one';
    }

    // --- Query execution ---
    const widgetData: WidgetDataMap = new Map();

    // Determine which widgets need query execution
    const widgetsToQuery = refinementLevel === 'layout'
      ? [] // Layout changes don't need queries — use empty data
      : def.widgets.filter(w => {
          if (w.type === 'text') return false;
          const hasQuery = 'query' in w && (w as any).query?.sql;
          if (!hasQuery) return false;
          // For widget-level refinement, only re-query affected widgets
          if (refinementLevel === 'widget') return affectedWidgetIds.has(w.id);
          // For dashboard-level, re-query all
          return true;
        });

    try {
      const results = await Promise.all(
        widgetsToQuery.map(async (widget) => {
          const query = (widget as any).query;
          const dsConfig = registry.getConfig(query.dataSourceId);
          const validation = validateQuery(query.sql, dsConfig.constraints);
          if (!validation.valid) {
            throw new Error(`Widget '${widget.id}' query failed: ${validation.error}`);
          }
          const result = await registry.execute(query.dataSourceId, query.sql, query.params);
          return { widgetId: widget.id, rows: result.rows };
        }),
      );

      for (const { widgetId, rows } of results) {
        widgetData.set(widgetId, rows);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `App refinement failed: ${message}`;
    }

    // --- Regenerate app ---
    try {
      // Ensure layout defaults
      if (!def.layout) def.layout = DEFAULT_APP_LAYOUT;
      if (!def.controls) def.controls = [{ type: 'theme-toggle' }];

      const app = generateApp(def, widgetData);
      const sizeKB = Math.round(app.sizeBytes / 1024);

      return {
        content: `Dashboard refined (${refinementLevel}) — ${app.widgetCount} widgets (${sizeKB}KB).`,
        artifacts: [{
          type: 'update',
          artifactId: appId,
          title: def.title,
          content: app.html,
          artifactType: 'code',
          language: 'html',
        }],
        blocks: [{
          type: 'custom:app/preview' as const,
          data: {
            appId,
            title: def.title,
            widgetCount: app.widgetCount,
            sizeBytes: app.sizeBytes,
          },
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `App regeneration failed: ${message}`;
    }
  };
}
