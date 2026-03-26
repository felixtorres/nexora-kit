/**
 * dashboard_render_chart tool handler.
 *
 * Takes a Vega-Lite spec + query results and returns a custom:dashboard/chart block.
 * The LLM generates the spec; this tool validates it and packages it for the frontend.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import { validateQuery } from '../query/validator.js';
import { validateVegaLiteSpec } from '../chart/validator.js';

export function createRenderChartHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dataSourceId = input.dataSourceId as string;
    const sql = input.sql as string;
    const specJson = input.spec as string;
    const title = (input.title as string) || 'Chart';

    if (!dataSourceId || !sql || !specJson) {
      return 'Error: dataSourceId, sql, and spec are required';
    }

    // Parse and validate the Vega-Lite spec
    let spec: Record<string, unknown>;
    try {
      spec = typeof specJson === 'string' ? JSON.parse(specJson) : specJson as Record<string, unknown>;
    } catch {
      return 'Error: spec must be valid JSON';
    }

    const specValidation = validateVegaLiteSpec(spec);
    if (!specValidation.valid) {
      return `Invalid Vega-Lite spec: ${specValidation.error}`;
    }

    // Validate and execute the query
    const config = registry.getConfig(dataSourceId);
    const validation = validateQuery(sql, config.constraints);
    if (!validation.valid) {
      return `Query validation failed: ${validation.error}`;
    }

    try {
      const result = await registry.execute(dataSourceId, sql);

      // Return custom dashboard chart block
      return {
        content: `Chart "${title}" generated with ${result.rowCount} data points.`,
        blocks: [{
          type: 'custom:dashboard/chart' as const,
          data: {
            widgetId: `chart-${Date.now()}`,
            title,
            spec: { engine: 'vega-lite', config: spec },
            data: result.rows,
            columns: result.columns,
            rowCount: result.rowCount,
            truncated: result.truncated,
          },
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Chart generation failed: ${message}`;
    }
  };
}
