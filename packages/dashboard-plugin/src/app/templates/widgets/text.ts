/**
 * Text content widget template.
 */

import type { AppTextWidget } from '../../types.js';
import { escapeHtml, escapeAttr } from '../../escaper.js';

export function renderTextWidget(widget: AppTextWidget): string {
  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="widget-header">
        <h3 class="widget-title">${escapeHtml(widget.title)}</h3>
      </div>
      <div class="text-content">${escapeHtml(widget.content)}</div>
    </div>
  `;
}
