/**
 * KPI card widget template.
 */

import type { AppKpiWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

export function renderKpiWidget(widget: AppKpiWidget, data: Record<string, unknown>[]): string {
  const row = data[0] ?? {};
  const rawValue = Number(row[widget.valueField] ?? 0);
  const formatted = formatValue(rawValue, widget.format);

  let deltaHtml = '';
  if (widget.comparisonField && row[widget.comparisonField] != null) {
    const delta = Number(row[widget.comparisonField]);
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const arrow = delta > 0 ? '&#9650;' : delta < 0 ? '&#9660;' : '&#8211;';
    const label = widget.comparisonLabel ? ` ${escapeHtml(widget.comparisonLabel)}` : '';
    deltaHtml = `<div class="kpi-delta ${direction}">${arrow} ${formatValue(Math.abs(delta), widget.format)}${label}</div>`;
  }

  let sparklineHtml = '';
  if (widget.sparkline) {
    sparklineHtml = `
      <div id="sparkline-${widget.id}" class="kpi-sparkline"></div>
      <script>
        (function(){
          var el=document.getElementById('sparkline-${escapeAttr(widget.id)}');
          if(!el)return;
          var vals=${escapeJsonForScript(data.map(r => Number(r[widget.valueField] ?? 0)))};
          var theme=document.documentElement.dataset.theme==='dark'?'dark':null;
          var chart=echarts.init(el,theme);
          chart.setOption({
            grid:{left:0,right:0,top:0,bottom:0},
            xAxis:{show:false,type:'category',data:vals.map(function(_,i){return i})},
            yAxis:{show:false,type:'value'},
            series:[{type:'line',data:vals,smooth:true,showSymbol:false,
              lineStyle:{width:1.5,color:'var(--accent)'},
              areaStyle:{opacity:0.1,color:'var(--accent)'}}]
          });
          window.__charts['sparkline-${escapeAttr(widget.id)}']=chart;
        })();
      </script>
    `;
  }

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="kpi-label">${escapeHtml(widget.title)}</div>
      <div class="kpi-value">${escapeHtml(formatted)}</div>
      ${deltaHtml}
      ${sparklineHtml}
    </div>
  `;
}

function formatValue(value: number, format?: 'number' | 'currency' | 'percent'): string {
  switch (format) {
    case 'currency':
      return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    case 'number':
    default:
      return value.toLocaleString('en-US');
  }
}
