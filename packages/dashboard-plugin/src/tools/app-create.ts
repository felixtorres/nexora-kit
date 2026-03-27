/**
 * dashboard:app_create tool handler.
 *
 * Generates a self-contained HTML/CSS/JS dashboard app from widget definitions.
 * The LLM generates widget configs; this tool validates, queries, and assembles.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type {
  AppDefinition,
  AppWidget,
  AppChartWidget,
  WidgetDataMap,
  AppLayout,
} from '../app/types.js';
import { DEFAULT_APP_LAYOUT, VALID_ECHART_TYPES } from '../app/types.js';
import { validateEChartsConfig, normalizeEChartsConfig } from '../chart/echarts-validator.js';
import { validateQuery } from '../query/validator.js';
import { generateApp } from '../app/generator.js';
import { randomUUID } from 'node:crypto';

export function createAppCreateHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const title = input.title as string;
    const widgetsJson = input.widgets as string;
    const theme = (input.theme as string) || 'auto';

    // --- Input validation ---
    if (!title) return 'Error: title is required';
    if (!widgetsJson) return 'Error: widgets JSON is required';

    let widgets: AppWidget[];
    try {
      const parsed = typeof widgetsJson === 'string' ? JSON.parse(widgetsJson) : widgetsJson;
      if (!Array.isArray(parsed)) return 'Error: widgets must be a JSON array';
      if (parsed.length === 0) return 'Error: widgets array must not be empty';
      widgets = parsed as AppWidget[];
    } catch {
      return 'Error: widgets must be valid JSON';
    }

    // Validate theme
    if (!['light', 'dark', 'auto'].includes(theme)) {
      return `Error: theme must be 'light', 'dark', or 'auto'`;
    }

    // --- Widget validation ---
    for (const widget of widgets) {
      const w = widget as unknown as Record<string, unknown>;
      if (!w.id) return `Error: widget is missing 'id'`;
      if (!w.type) return `Error: widget '${w.id}' is missing 'type'`;
      if (!w.title) return `Error: widget '${w.id}' is missing 'title'`;
      if (!w.size) return `Error: widget '${w.id}' is missing 'size'`;

      // Validate chart widgets
      if (widget.type === 'chart') {
        const chartWidget = widget as AppChartWidget;
        if (!chartWidget.chartType) {
          return `Error: chart widget '${widget.id}' is missing 'chartType'`;
        }
        if (!VALID_ECHART_TYPES.has(chartWidget.chartType)) {
          return `Error: chart widget '${widget.id}' has invalid chartType '${chartWidget.chartType}'`;
        }
        if (!chartWidget.config) {
          return `Error: chart widget '${widget.id}' is missing 'config'`;
        }

        // Validate and normalize ECharts config
        const configResult = normalizeEChartsConfig(chartWidget.config, chartWidget.chartType);
        if (typeof configResult === 'string') {
          return `Widget '${widget.id}': ${configResult}`;
        }
        chartWidget.config = configResult.config;
      }
    }

    // --- Query execution ---
    const widgetData: WidgetDataMap = new Map();

    // Collect widgets that need query execution
    const queryWidgets = widgets.filter(
      w => w.type !== 'text' && 'query' in w && (w as any).query?.sql,
    );

    try {
      const results = await Promise.all(
        queryWidgets.map(async (widget) => {
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
      return `App creation failed: ${message}`;
    }

    // --- Generate app ---
    const definition: AppDefinition = {
      title,
      theme: theme as 'light' | 'dark' | 'auto',
      widgets,
      layout: DEFAULT_APP_LAYOUT,
      controls: [{ type: 'theme-toggle' }],
    };

    try {
      const app = generateApp(definition, widgetData);
      const artifactId = randomUUID();
      const sizeKB = Math.round(app.sizeBytes / 1024);

      return {
        content: `Dashboard app "${title}" generated — ${app.widgetCount} widgets (${sizeKB}KB).`,
        artifacts: [{
          type: 'create',
          artifactId,
          title,
          content: app.html,
          artifactType: 'code',
          language: 'html',
        }],
        blocks: [{
          type: 'custom:app/preview' as const,
          data: {
            appId: artifactId,
            title,
            html: app.html,
            widgetCount: app.widgetCount,
            sizeBytes: app.sizeBytes,
          },
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `App generation failed: ${message}`;
    }
  };
}
