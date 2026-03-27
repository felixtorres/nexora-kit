/**
 * Metric card widget template — value + optional mini sparkline.
 */

import type { AppMetricCardWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

export function renderMetricCardWidget(widget: AppMetricCardWidget, data: Record<string, unknown>[]): string {
  const row = data[0] ?? {};
  const rawValue = Number(row[widget.valueField] ?? 0);
  const formatted = formatMetricValue(rawValue, widget.format);

  let sparklineHtml = '';
  if (widget.sparklineField && data.length > 1) {
    const sparkId = `metric-spark-${widget.id}`;
    const vals = data.map(r => Number(r[widget.sparklineField!] ?? 0));
    sparklineHtml = `
      <div id="${sparkId}" class="metric-sparkline"></div>
      <script>
        (function(){
          var el=document.getElementById('${sparkId}');
          if(!el)return;
          var vals=${escapeJsonForScript(vals)};
          var theme=document.documentElement.dataset.theme==='dark'?'dark':null;
          var chart=echarts.init(el,theme);
          chart.setOption({
            grid:{left:0,right:0,top:2,bottom:2},
            xAxis:{show:false,type:'category',data:vals.map(function(_,i){return i})},
            yAxis:{show:false,type:'value'},
            series:[{type:'line',data:vals,smooth:true,showSymbol:false,
              lineStyle:{width:1.5,color:'var(--accent)'},
              areaStyle:{opacity:0.1,color:'var(--accent)'}}]
          });
          window.__charts['${sparkId}']=chart;
        })();
      </script>
    `;
  }

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="kpi-label">${escapeHtml(widget.title)}</div>
      <div class="metric-card-value">${escapeHtml(formatted)}</div>
      ${sparklineHtml}
    </div>
  `;
}

function formatMetricValue(value: number, format?: 'number' | 'currency' | 'percent'): string {
  switch (format) {
    case 'currency':
      return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    default:
      return value.toLocaleString('en-US');
  }
}
