/**
 * Date range picker control template.
 */

import { escapeAttr, escapeHtml } from '../../escaper.js';

export function renderDateRange(field: string, label?: string): string {
  const displayLabel = label ?? 'Date range';
  return `
    <div class="control-group" style="display:flex;align-items:center;gap:6px">
      <label class="control-label" style="font-size:0.75rem;color:var(--text-secondary)">${escapeHtml(displayLabel)}</label>
      <input type="date" id="date-from-${escapeAttr(field)}" data-date-filter="${escapeAttr(field)}"
             class="control-input" onchange="window.__applyDateRange('${escapeAttr(field)}')"
             style="font-size:0.75rem;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text-primary)">
      <span style="font-size:0.75rem;color:var(--text-muted)">to</span>
      <input type="date" id="date-to-${escapeAttr(field)}" data-date-filter="${escapeAttr(field)}"
             class="control-input" onchange="window.__applyDateRange('${escapeAttr(field)}')"
             style="font-size:0.75rem;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text-primary)">
    </div>
  `;
}
