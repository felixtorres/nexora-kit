/**
 * ECharts chart widget template.
 *
 * Supports chart type switching (bar/line toggle) and cross-filtering
 * (clicking a data point filters all other widgets).
 */

import type { AppChartWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

/**
 * Check whether an encode mapping references columns that exist in the data.
 */
function encodeMatchesColumns(
  encode: Record<string, unknown>,
  columns: string[],
): boolean {
  const colSet = new Set(columns);
  for (const val of Object.values(encode)) {
    if (typeof val === 'string' && !colSet.has(val)) return false;
    // ECharts supports array values for encode (e.g. candlestick y: [open,close,low,high])
    if (Array.isArray(val) && val.some((v) => typeof v === 'string' && !colSet.has(v))) return false;
  }
  return true;
}

/**
 * Ensure the ECharts config is compatible with dataset injection.
 *
 * When query data is available: strips inline data from series/axes,
 * infers encode mappings, and validates that encode fields match actual columns.
 * When data is empty: preserves any inline data the LLM placed in the config.
 */
function prepareConfigForDataset(
  config: Record<string, unknown>,
  chartType: string,
  data: Record<string, unknown>[],
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const hasData = data.length > 0;
  const columns = hasData ? Object.keys(data[0]) : [];

  // Only strip axis inline data when we have query data to replace it
  if (hasData) {
    if (result.xAxis && typeof result.xAxis === 'object' && !Array.isArray(result.xAxis)) {
      delete (result.xAxis as Record<string, unknown>).data;
    }
    if (result.yAxis && typeof result.yAxis === 'object' && !Array.isArray(result.yAxis)) {
      delete (result.yAxis as Record<string, unknown>).data;
    }
  }

  // Process series: strip inline data, ensure encode exists, expand for multi-column data
  if (result.series) {
    let series = Array.isArray(result.series) ? result.series : [result.series];
    const cartesianTypes = ['bar', 'line', 'area', 'scatter'];
    const yColumns = columns.slice(1); // columns[0] is typically the x/category axis

    // Auto-expand: if there's a single cartesian series with no encode and
    // the query returned more value columns than series, create one series per column
    if (
      hasData &&
      series.length === 1 &&
      yColumns.length > 1 &&
      typeof series[0] === 'object' && series[0] !== null
    ) {
      const template = series[0] as Record<string, unknown>;
      const serType = (template.type as string) ?? chartType;
      if (cartesianTypes.includes(serType) && !template.encode) {
        series = yColumns.map((col) => ({
          ...JSON.parse(JSON.stringify(template)),
          name: col,
          encode: { x: columns[0], y: col },
        }));
      }
    }

    // Track column assignment for remaining series without encode
    let nextYIndex = 0;
    for (const s of series) {
      if (typeof s !== 'object' || s === null) continue;
      const ser = s as Record<string, unknown>;

      // Only strip inline data when we have query data to replace it
      if (hasData) {
        delete ser.data;
      }

      const serType = (ser.type as string) ?? chartType;
      const needsEncode = !ser.encode || (hasData && !encodeMatchesColumns(ser.encode as Record<string, unknown>, columns));

      // Auto-infer encode if missing, or if existing encode doesn't match data columns
      if (needsEncode && columns.length >= 2) {
        if (['pie', 'donut'].includes(serType)) {
          ser.encode = { itemName: columns[0], value: yColumns[nextYIndex] ?? yColumns[0] };
          nextYIndex++;
        } else if (cartesianTypes.includes(serType)) {
          ser.encode = { x: columns[0], y: yColumns[nextYIndex] ?? yColumns[0] };
          nextYIndex++;
        }
      }
    }
    result.series = series;

    // Auto-add legend when there are multiple series
    if (series.length > 1 && !result.legend) {
      result.legend = { show: true };
    }
  }

  return result;
}

export function renderChartWidget(widget: AppChartWidget, data: Record<string, unknown>[]): string {
  const containerId = `chart-${widget.id}`;
  const switchable = ['bar', 'line', 'area'].includes(widget.chartType);
  const config = prepareConfigForDataset(widget.config, widget.chartType, data);
  const echartsOption: Record<string, unknown> = {
    ...config,
    tooltip: config.tooltip ?? { trigger: 'axis' },
    grid: config.grid ?? { left: 60, right: 20, top: 40, bottom: 40 },
  };
  // Only inject dataset when we have query data — otherwise let inline config data render
  if (data.length > 0) {
    echartsOption.dataset = { source: data };
  }

  const switchBtn = switchable
    ? `<button class="btn-icon" id="switch-${escapeAttr(widget.id)}" onclick="window.__switchChartType('${escapeAttr(widget.id)}')" title="Switch chart type">&#9776;</button>`
    : '';

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="widget-header">
        <h3 class="widget-title">${escapeHtml(widget.title)}</h3>
        <div class="widget-actions">
          ${switchBtn}
          <button class="btn-icon" onclick="window.__exportChart('${escapeAttr(widget.id)}','png')" title="Export PNG">&#8615;</button>
        </div>
      </div>
      <div id="${containerId}" class="chart-container"></div>
    </div>
    <script>
      (function(){
        var el=document.getElementById('${containerId}');
        var theme=document.documentElement.dataset.theme==='dark'?'dark':null;
        var chart=echarts.init(el,theme);
        chart.setOption(${escapeJsonForScript(echartsOption)});
        window.__charts['${escapeAttr(widget.id)}']=chart;
        window.__widgets['${escapeAttr(widget.id)}']={
          type:'chart',data:${escapeJsonForScript(data)},
          originalData:${escapeJsonForScript(data)},chart:chart
        };
        chart.on('click',function(params){
          if(params.name && window.__applyFilter){
            var dim=params.dimensionNames?params.dimensionNames[0]:null;
            if(dim) window.__applyFilter(dim,params.data?params.data[dim]:params.name);
          }
        });
      })();
    </script>
  `;
}
