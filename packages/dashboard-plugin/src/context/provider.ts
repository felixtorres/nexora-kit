/**
 * Skill context provider for the dashboard plugin.
 *
 * Injects into the LLM context:
 * - Available data sources + schemas + sample data
 * - Vega-Lite few-shot examples for common chart types
 * - Charting rules and best practices
 */

import type { DataSourceRegistry } from '../data-sources/registry.js';
import type { SqlAdapter } from '../data-sources/sql-adapter.js';

/**
 * Build the skill context string for injection into LLM prompts.
 */
export async function buildDashboardContext(registry: DataSourceRegistry): Promise<string> {
  const sections: string[] = [];

  sections.push('# Dashboard Plugin Context');
  sections.push('');

  // Data sources
  const sources = registry.list();
  if (sources.length > 0) {
    sections.push('## Available Data Sources');
    sections.push('');
    for (const source of sources) {
      sections.push(`### ${source.name} (id: \`${source.id}\`)`);
      try {
        const schema = await registry.getSchema(source.id);
        for (const table of schema.tables) {
          sections.push(`**${table.name}** (${table.rowCountEstimate ?? '?'} rows)`);
          const colList = table.columns
            .map((c) => `  - \`${c.name}\` (${c.type}${c.isPrimaryKey ? ', PK' : ''})`)
            .join('\n');
          sections.push(colList);
          sections.push('');

          // Sample data
          try {
            const sample = await registry.getSampleData(source.id, table.name, 3);
            if (sample.rows.length > 0) {
              sections.push('Sample: ' + JSON.stringify(sample.rows.slice(0, 3)));
              sections.push('');
            }
          } catch {
            // best-effort
          }
        }
      } catch {
        sections.push('(schema unavailable)');
        sections.push('');
      }
    }
  }

  // Vega-Lite examples
  sections.push(VEGA_LITE_EXAMPLES);

  // Charting rules
  sections.push(CHARTING_RULES);

  return sections.join('\n');
}

const VEGA_LITE_EXAMPLES = `
## Vega-Lite Chart Examples

When generating charts, output a valid Vega-Lite JSON spec. Do NOT include data in the spec — data is injected by the plugin.

### Bar chart
\`\`\`json
{
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative", "aggregate": "sum" },
    "color": { "field": "category", "type": "nominal" }
  }
}
\`\`\`

### Line chart (time series)
\`\`\`json
{
  "mark": "line",
  "encoding": {
    "x": { "field": "date", "type": "temporal", "title": "Date" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue" },
    "color": { "field": "region", "type": "nominal" }
  }
}
\`\`\`

### Stacked bar chart
\`\`\`json
{
  "mark": "bar",
  "encoding": {
    "x": { "field": "month", "type": "ordinal" },
    "y": { "field": "sales", "type": "quantitative", "aggregate": "sum" },
    "color": { "field": "product", "type": "nominal" }
  }
}
\`\`\`

### Scatter plot
\`\`\`json
{
  "mark": "point",
  "encoding": {
    "x": { "field": "weight", "type": "quantitative" },
    "y": { "field": "height", "type": "quantitative" },
    "color": { "field": "species", "type": "nominal" },
    "tooltip": [
      { "field": "name", "type": "nominal" },
      { "field": "weight", "type": "quantitative" },
      { "field": "height", "type": "quantitative" }
    ]
  }
}
\`\`\`

### Pie / donut chart
\`\`\`json
{
  "mark": { "type": "arc", "innerRadius": 50 },
  "encoding": {
    "theta": { "field": "share", "type": "quantitative" },
    "color": { "field": "segment", "type": "nominal" }
  }
}
\`\`\`

### Heatmap
\`\`\`json
{
  "mark": "rect",
  "encoding": {
    "x": { "field": "day", "type": "ordinal" },
    "y": { "field": "hour", "type": "ordinal" },
    "color": { "field": "count", "type": "quantitative" }
  }
}
\`\`\`
`;

const CHARTING_RULES = `
## Charting Rules

1. **Always aggregate before charting.** Use \`aggregate: "sum"\`, \`"mean"\`, \`"count"\` etc. in the encoding. Do not plot raw rows unless explicitly requested.
2. **Use appropriate mark types:** bar for categorical comparisons, line for time series, point for scatter/correlation, arc for parts-of-whole.
3. **Include axis labels and titles.** Use the \`title\` field in x/y encodings.
4. **Add tooltips** for interactive exploration — include relevant fields.
5. **Limit categories.** If a dimension has >15 unique values, aggregate or filter to the top N.
6. **Use temporal type** for date columns, not ordinal.
7. **Do NOT include \`data\` in the spec** — the plugin injects query results automatically.
8. **Use SQL GROUP BY** to aggregate data before charting when the dataset is large. Do not rely on client-side aggregation for datasets > 1000 rows.
`;
