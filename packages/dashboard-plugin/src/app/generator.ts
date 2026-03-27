/**
 * App generator — orchestrates the template engine to produce
 * self-contained HTML dashboard apps.
 *
 * Pure function: AppDefinition + widget data → GeneratedApp.
 * No I/O, no side effects, fully testable.
 */

import type {
  AppDefinition,
  AppWidget,
  GeneratedApp,
  WidgetDataMap,
} from './types.js';
import { buildStylesheet } from './templates/styles.js';
import { buildRuntimeScript } from './templates/runtime.js';
import { buildHtmlShell } from './templates/base.js';
import { renderThemeToggle } from './templates/controls/theme-toggle.js';
import { renderDateRange } from './templates/controls/date-range.js';
import { renderDropdownFilter } from './templates/controls/dropdown.js';
import { renderExportButton } from './templates/controls/export.js';
import { renderChartWidget } from './templates/widgets/chart.js';
import { renderKpiWidget } from './templates/widgets/kpi.js';
import { renderTableWidget } from './templates/widgets/table.js';
import { renderStatWidget } from './templates/widgets/stat.js';
import { renderGaugeWidget } from './templates/widgets/gauge.js';
import { renderMetricCardWidget } from './templates/widgets/metric-card.js';
import { renderTextWidget } from './templates/widgets/text.js';
import type {
  AppChartWidget,
  AppKpiWidget,
  AppTableWidget,
  AppStatWidget,
  AppGaugeWidget,
  AppMetricCardWidget,
  AppTextWidget,
} from './types.js';

/**
 * Generate a self-contained HTML dashboard app.
 *
 * @param definition The app definition (widgets, layout, theme, controls)
 * @param widgetData Query results keyed by widget ID
 * @returns GeneratedApp with the full HTML string and metadata
 * @throws Error if definition has no widgets
 */
export function generateApp(definition: AppDefinition, widgetData: WidgetDataMap): GeneratedApp {
  if (!definition.widgets || definition.widgets.length === 0) {
    throw new Error('AppDefinition must have at least one widget');
  }

  // 1. Build CSS
  const css = buildStylesheet(definition.layout);

  // 2. Render each widget
  const widgetHtmlParts = definition.widgets.map(widget => {
    const data = widgetData.get(widget.id) ?? [];
    return renderWidget(widget, data);
  });
  const widgetHtml = widgetHtmlParts.join('\n');

  // 3. Render controls
  const controlsHtml = renderControls(definition);

  // 4. Build runtime JS
  const runtimeJs = buildRuntimeScript();

  // 5. Serialize definition for embedding (enables refresh/extraction)
  const definitionForEmbed = { ...definition };
  const definitionJson = JSON.stringify(definitionForEmbed).replace(/<\//g, '<\\/');

  // 6. Assemble HTML shell
  const html = buildHtmlShell({
    title: definition.title,
    description: definition.description,
    css,
    widgetHtml,
    runtimeJs,
    controlsHtml,
    theme: definition.theme,
    definitionJson,
  });

  return {
    html,
    title: definition.title,
    widgetCount: definition.widgets.length,
    sizeBytes: Buffer.byteLength(html, 'utf-8'),
  };
}

function renderWidget(widget: AppWidget, data: Record<string, unknown>[]): string {
  switch (widget.type) {
    case 'chart':
      return renderChartWidget(widget as AppChartWidget, data);
    case 'kpi':
      return renderKpiWidget(widget as AppKpiWidget, data);
    case 'table':
      return renderTableWidget(widget as AppTableWidget, data);
    case 'stat':
      return renderStatWidget(widget as AppStatWidget, data);
    case 'gauge':
      return renderGaugeWidget(widget as AppGaugeWidget, data);
    case 'metric-card':
      return renderMetricCardWidget(widget as AppMetricCardWidget, data);
    case 'text':
      return renderTextWidget(widget as AppTextWidget);
    default:
      return `<!-- Unknown widget type: ${(widget as any).type} -->`;
  }
}

function renderControls(definition: AppDefinition): string {
  const controls = definition.controls ?? [];
  const parts: string[] = [];

  for (const control of controls) {
    switch (control.type) {
      case 'theme-toggle':
        parts.push(renderThemeToggle());
        break;
      case 'date-range':
        parts.push(renderDateRange(control.field, 'Date range'));
        break;
      case 'dropdown-filter':
        parts.push(renderDropdownFilter(control.field, control.label, control.options));
        break;
      case 'export':
        parts.push(renderExportButton(control.formats));
        break;
      default:
        break;
    }
  }

  return parts.join('\n');
}
