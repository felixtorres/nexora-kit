/**
 * Stat block widget template — compact value + label + trend arrow.
 */

import type { AppStatWidget } from '../../types.js';
import { escapeHtml, escapeAttr } from '../../escaper.js';

export function renderStatWidget(widget: AppStatWidget, data: Record<string, unknown>[]): string {
  const row = data[0] ?? {};
  const rawValue = Number(row[widget.valueField] ?? 0);
  const formatted = formatStatValue(rawValue, widget.format);

  let trendHtml = '';
  if (widget.trendField && row[widget.trendField] != null) {
    const trend = Number(row[widget.trendField]);
    const direction = trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat';
    const arrow = trend > 0 ? '&#9650;' : trend < 0 ? '&#9660;' : '&#8211;';
    trendHtml = `<div class="stat-trend kpi-delta ${direction}">${arrow} ${Math.abs(trend).toLocaleString('en-US')}</div>`;
  }

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="stat-label">${escapeHtml(widget.title)}</div>
      <div class="stat-value">${escapeHtml(formatted)}</div>
      ${trendHtml}
    </div>
  `;
}

function formatStatValue(value: number, format?: 'number' | 'currency' | 'percent'): string {
  switch (format) {
    case 'currency':
      return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    default:
      return value.toLocaleString('en-US');
  }
}
