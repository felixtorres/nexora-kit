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

export interface ContextOptions {
  /** Plugin mode — controls which chart examples to inject. */
  mode?: 'classic' | 'app' | 'both';
}

/**
 * Build the skill context string for injection into LLM prompts.
 */
export async function buildDashboardContext(
  registry: DataSourceRegistry,
  options?: ContextOptions,
): Promise<string> {
  const sections: string[] = [];

  sections.push('# Dashboard Plugin');
  sections.push('');
  sections.push('## IMPORTANT: Behavioral Rules');
  sections.push('');
  sections.push('- When the user asks for a dashboard, chart, or data visualization: **call the tool immediately**. Do NOT explain what you would build — BUILD IT.');
  sections.push('- Examine the available data sources and schemas below, pick the right queries and chart types, and call `dashboard_app_create` (or `dashboard_create` in classic mode) in your FIRST response.');
  sections.push('- Keep your text response SHORT — one sentence confirming what you built. The app itself is the answer.');
  sections.push('- If the user asks to change something about an existing dashboard, call `dashboard_app_refine` immediately.');
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

  const mode = options?.mode ?? 'both';

  // Chart examples — mode-dependent
  if (mode === 'classic' || mode === 'both') {
    sections.push(VEGA_LITE_EXAMPLES);
    sections.push(CHARTING_RULES);
  }
  if (mode === 'app' || mode === 'both') {
    sections.push(ECHARTS_EXAMPLES);
    sections.push(APP_GENERATION_RULES);
  }

  return sections.join('\n');
}

const VEGA_LITE_EXAMPLES = `
## Vega-Lite Reference (Classic Mode)

Call \`dashboard_create\` immediately. Spec patterns (no data — injected automatically):
- **bar**: \`{mark:"bar", encoding:{x:{field,type:"nominal"}, y:{field,type:"quantitative",aggregate:"sum"}}}\`
- **line**: \`{mark:"line", encoding:{x:{field,type:"temporal"}, y:{field,type:"quantitative"}}}\`
- **pie**: \`{mark:{type:"arc",innerRadius:50}, encoding:{theta:{field,type:"quantitative"}, color:{field,type:"nominal"}}}\`
- **scatter**: \`{mark:"point", encoding:{x:{field,type:"quantitative"}, y:{field,type:"quantitative"}}}\`
- **heatmap**: \`{mark:"rect", encoding:{x:{field,type:"ordinal"}, y:{field,type:"ordinal"}, color:{field,type:"quantitative"}}}\`
`;

const CHARTING_RULES = `
Use SQL GROUP BY for aggregation. Add tooltips. Use temporal type for dates. Never include data in spec.
`;

const ECHARTS_EXAMPLES = `
## ECharts Reference (App Mode)

Call \`dashboard_app_create\` with a widgets JSON array. Each chart widget needs \`chartType\` and \`config\` (ECharts option, no data). Data is injected automatically from query results.

Widget config patterns:
- **bar/line/area/scatter**: \`{ xAxis:{type:"category"}, yAxis:{type:"value"}, series:[{type:"bar", encode:{x:"col",y:"col"}}], tooltip:{trigger:"axis"} }\`
- **pie/donut**: \`{ series:[{type:"pie", radius:["40%","70%"], encode:{itemName:"col",value:"col"}}], tooltip:{trigger:"item"} }\`
- **gauge**: \`{ series:[{type:"gauge", detail:{formatter:"{value}%"}, data:[{value:72}]}] }\`
- **heatmap**: \`{ xAxis:{type:"category"}, yAxis:{type:"category"}, visualMap:{min:0,max:100}, series:[{type:"heatmap"}], tooltip:{} }\`
- **candlestick**: \`{ xAxis:{type:"category"}, yAxis:{type:"value",scale:true}, series:[{type:"candlestick", encode:{x:"date",y:["open","close","low","high"]}}], dataZoom:[{type:"inside"},{type:"slider"}] }\`
- **kpi** widget: \`{ type:"kpi", valueField:"col", format:"currency"|"number"|"percent" }\` — query must return 1 row
- **table** widget: \`{ type:"table", columns:[{key,label}], sortable:true, pageSize:20 }\`

Time series: use \`xAxis.type:"time"\` + \`dataZoom\`. Use SQL GROUP BY for aggregation.
Never use JS functions in configs — declarative strings only (\`"{value}%"\` not \`function(){}\`).
`;

const APP_GENERATION_RULES = `
## App Widget Layout

Grid is 12 columns. Set \`size: {col, row, width, height}\` on each widget.
Typical layout: KPIs in row 1 (width:3 each), charts in row 2-4 (width:6), table in row 5+ (width:12).
Always include \`query: {dataSourceId, sql}\` for data-driven widgets. Use the data source IDs listed above.
`;
