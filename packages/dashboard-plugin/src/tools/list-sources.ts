/**
 * dashboard_list_sources tool handler.
 *
 * Lists available data sources and their schemas.
 * Optionally returns detailed schema + sample data for a specific source.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { SqlAdapter } from '../data-sources/sql-adapter.js';

export function createListSourcesHandler(registry: DataSourceRegistry): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dataSourceId = input.dataSourceId as string | undefined;
    const refresh = input.refresh as boolean | undefined;

    if (dataSourceId) {
      return getSourceDetail(registry, dataSourceId, refresh);
    }
    return listAllSources(registry);
  };
}

async function listAllSources(registry: DataSourceRegistry): Promise<string> {
  const sources = registry.list();

  if (sources.length === 0) {
    return 'No data sources are configured. An operator needs to register data sources in the plugin configuration.';
  }

  const lines: string[] = ['Available data sources:', ''];
  for (const source of sources) {
    const schema = await registry.getSchema(source.id);
    const tableNames = schema.tables.map((t) => t.name).join(', ');
    lines.push(`- **${source.name}** (id: \`${source.id}\`, type: ${source.config.type})`);
    lines.push(`  Tables: ${tableNames}`);
    lines.push(`  Constraints: max ${source.constraints.maxRows} rows, ${source.constraints.timeoutMs}ms timeout`);
    if (source.constraints.allowedTables) {
      lines.push(`  Allowed tables: ${source.constraints.allowedTables.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function getSourceDetail(
  registry: DataSourceRegistry,
  dataSourceId: string,
  refresh?: boolean,
): Promise<string> {
  const config = registry.getConfig(dataSourceId);
  const adapter = registry.get(dataSourceId);
  const schema = await adapter.introspectSchema();

  const lines: string[] = [
    `# Data Source: ${config.name} (\`${config.id}\`)`,
    '',
    `Type: ${config.config.type}`,
    `Tables: ${schema.tables.length}`,
    '',
  ];

  for (const table of schema.tables) {
    lines.push(`## ${table.name}`);
    if (table.rowCountEstimate !== undefined) {
      lines.push(`Estimated rows: ${table.rowCountEstimate}`);
    }
    lines.push('');
    lines.push('| Column | Type | Nullable | PK |');
    lines.push('|--------|------|----------|----|');

    for (const col of table.columns) {
      lines.push(
        `| ${col.name} | ${col.type} | ${col.nullable ? 'yes' : 'no'} | ${col.isPrimaryKey ? 'yes' : '' } |`,
      );
    }
    lines.push('');

    // Include sample data (top 5 rows)
    try {
      const sample = await adapter.getSampleData(table.name, 5);
      if (sample.rows.length > 0) {
        lines.push('**Sample data (first 5 rows):**');
        lines.push('```json');
        lines.push(JSON.stringify(sample.rows, null, 2));
        lines.push('```');
        lines.push('');
      }
    } catch {
      // Sample data is best-effort
    }

    // Include column stats if adapter supports it
    if ('getColumnStats' in adapter) {
      try {
        const stats = await (adapter as SqlAdapter).getColumnStats(table.name);
        const statsEntries = [...stats.entries()].filter(([, s]) =>
          s.sampleValues || s.distinctCount !== undefined,
        );
        if (statsEntries.length > 0) {
          lines.push('**Column statistics:**');
          for (const [colName, stat] of statsEntries) {
            const parts: string[] = [];
            if (stat.distinctCount !== undefined) parts.push(`${stat.distinctCount} distinct`);
            if (stat.min !== undefined) parts.push(`min: ${stat.min}`);
            if (stat.max !== undefined) parts.push(`max: ${stat.max}`);
            if (stat.sampleValues) parts.push(`values: ${stat.sampleValues.join(', ')}`);
            lines.push(`- \`${colName}\`: ${parts.join(' | ')}`);
          }
          lines.push('');
        }
      } catch {
        // Stats are best-effort
      }
    }
  }

  return lines.join('\n');
}
