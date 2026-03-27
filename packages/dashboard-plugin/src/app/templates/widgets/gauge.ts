/**
 * ECharts gauge widget template.
 */

import type { AppGaugeWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

export function renderGaugeWidget(widget: AppGaugeWidget, data: Record<string, unknown>[]): string {
  const row = data[0] ?? {};
  const value = Number(row[widget.valueField] ?? 0);
  const containerId = `gauge-${widget.id}`;

  const option: Record<string, unknown> = {
    series: [{
      type: 'gauge',
      min: widget.min ?? 0,
      max: widget.max ?? 100,
      detail: { formatter: '{value}', fontSize: 20 },
      data: [{ value, name: widget.title }],
      axisLine: { lineStyle: { width: 15 } },
    }],
  };

  if (widget.thresholds && widget.thresholds.length > 0) {
    const max = widget.max ?? 100;
    const colors = widget.thresholds.map(t => [t.value / max, t.color] as [number, string]);
    (option.series as any[])[0].axisLine = {
      lineStyle: { width: 15, color: colors },
    };
  }

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="widget-header">
        <h3 class="widget-title">${escapeHtml(widget.title)}</h3>
      </div>
      <div id="${containerId}" class="gauge-container"></div>
    </div>
    <script>
      (function(){
        var el=document.getElementById('${containerId}');
        var theme=document.documentElement.dataset.theme==='dark'?'dark':null;
        var chart=echarts.init(el,theme);
        chart.setOption(${escapeJsonForScript(option)});
        window.__charts['${escapeAttr(widget.id)}']=chart;
      })();
    </script>
  `;
}
