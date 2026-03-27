/**
 * Data table widget template.
 *
 * Supports sortable columns, search, and client-side pagination.
 */

import type { AppTableWidget } from '../../types.js';
import { escapeHtml, escapeAttr, escapeJsonForScript } from '../../escaper.js';

export function renderTableWidget(widget: AppTableWidget, data: Record<string, unknown>[]): string {
  const pageSize = widget.pageSize ?? 25;
  const totalRows = data.length;
  const displayRows = data.slice(0, pageSize);
  const sortableClass = widget.sortable ? ' sortable' : '';

  const headerCells = widget.columns
    .map(col => `<th class="${sortableClass}" data-key="${escapeAttr(col.key)}"${
      widget.sortable ? ` onclick="window.__sortTable('${escapeAttr(widget.id)}','${escapeAttr(col.key)}')"` : ''
    }>${escapeHtml(col.label)}</th>`)
    .join('');

  const bodyRows = displayRows
    .map(row => {
      const cells = widget.columns
        .map(col => `<td>${escapeHtml(String(row[col.key] ?? ''))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const searchHtml = widget.searchable
    ? `<input type="text" placeholder="Search..." class="table-search" oninput="window.__searchTable('${escapeAttr(widget.id)}',this.value)">`
    : '';

  const footerHtml = totalRows > pageSize
    ? `<div class="table-footer" id="footer-${widget.id}">
        <span>Showing 1-${Math.min(pageSize, totalRows)} of ${totalRows}</span>
        <div class="table-pagination" id="pagination-${widget.id}"></div>
       </div>`
    : `<div class="table-footer" id="footer-${widget.id}"><span>${totalRows} rows</span></div>`;

  return `
    <div class="widget-card" data-widget-id="${escapeAttr(widget.id)}"
         style="grid-column: ${widget.size.col} / span ${widget.size.width};
                grid-row: ${widget.size.row} / span ${widget.size.height};">
      <div class="widget-header">
        <h3 class="widget-title">${escapeHtml(widget.title)}</h3>
        <div class="widget-actions">
          ${searchHtml}
          <button class="btn-icon" onclick="window.__exportTableCsv('${escapeAttr(widget.id)}')" title="Export CSV">&#8615;</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="widget-table" id="table-${widget.id}">
          <thead><tr>${headerCells}</tr></thead>
          <tbody id="tbody-${widget.id}">${bodyRows}</tbody>
        </table>
      </div>
      ${footerHtml}
    </div>
    <script>
      (function(){
        window.__widgets['${escapeAttr(widget.id)}']={
          type:'table',
          data:${escapeJsonForScript(data)},
          originalData:${escapeJsonForScript(data)},
          columns:${escapeJsonForScript(widget.columns)},
          pageSize:${pageSize},
          currentPage:0,
          sortColumn:null,
          sortDirection:1
        };
      })();
    </script>
  `;
}
