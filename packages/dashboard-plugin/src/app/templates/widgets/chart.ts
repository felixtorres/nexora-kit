/**
 * ECharts chart widget template.
 *
 * Supports chart type switching (bar/line toggle) and cross-filtering
 * (clicking a data point filters all other widgets).
 */

import type { AppChartWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

export function renderChartWidget(widget: AppChartWidget, data: Record<string, unknown>[]): string {
  const containerId = `chart-${widget.id}`;
  const switchable = ['bar', 'line', 'area'].includes(widget.chartType);
  const echartsOption = {
    ...widget.config,
    dataset: { source: data },
    tooltip: widget.config.tooltip ?? { trigger: 'axis' },
    grid: widget.config.grid ?? { left: 60, right: 20, top: 40, bottom: 40 },
  };

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
