/**
 * dashboard_query tool handler.
 *
 * Executes a read-only SQL query against a registered data source.
 * Validates the query, enforces constraints, and returns tabular results.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import { validateQuery } from '../query/validator.js';

/** Max rows returned in tool output (LLM context is expensive) */
const TOOL_OUTPUT_MAX_ROWS = 50;

export function createQueryHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dataSourceId = input.dataSourceId as string;
    const sql = input.sql as string;
    const params = input.params as Record<string, unknown> | undefined;

    if (!dataSourceId) {
      return 'Error: dataSourceId is required';
    }
    if (!sql) {
      return 'Error: sql query is required';
    }

    // Validate the query before execution
    const config = registry.getConfig(dataSourceId);
    const validation = validateQuery(sql, config.constraints);
    if (!validation.valid) {
      return `Query validation failed: ${validation.error}`;
    }

    try {
      const result = await registry.execute(dataSourceId, sql, params);

      // Build response with column types (helps LLM choose chart encodings)
      const columnInfo = result.columns.map((c) => `${c.key} (${c.type})`).join(', ');
      const truncatedForDisplay = result.rowCount > TOOL_OUTPUT_MAX_ROWS;
      const displayRows = truncatedForDisplay
        ? result.rows.slice(0, TOOL_OUTPUT_MAX_ROWS)
        : result.rows;

      const lines: string[] = [
        `Query returned ${result.rowCount} rows${result.truncated ? ' (truncated by server limit)' : ''}.`,
        `Columns: ${columnInfo}`,
        '',
      ];

      if (truncatedForDisplay) {
        lines.push(`Showing first ${TOOL_OUTPUT_MAX_ROWS} of ${result.rowCount} rows:`);
      }

      lines.push('```json');
      lines.push(JSON.stringify(displayRows, null, 2));
      lines.push('```');

      return {
        content: lines.join('\n'),
        blocks: [{
          type: 'table',
          columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
          rows: displayRows,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Query execution failed: ${message}`;
    }
  };
}
