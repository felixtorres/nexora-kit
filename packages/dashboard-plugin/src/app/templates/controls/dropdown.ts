/**
 * Dropdown filter control template.
 */

import { escapeAttr, escapeHtml } from '../../escaper.js';

export function renderDropdownFilter(field: string, label: string, options?: string[]): string {
  const optionHtml = options
    ? options.map(o => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('')
    : '';

  return `
    <div class="control-group" style="display:flex;align-items:center;gap:6px">
      <label class="control-label" style="font-size:0.75rem;color:var(--text-secondary)">${escapeHtml(label)}</label>
      <select id="filter-${escapeAttr(field)}" data-filter-field="${escapeAttr(field)}"
              onchange="window.__applyFilter('${escapeAttr(field)}',this.value||null)"
              style="font-size:0.75rem;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text-primary)">
        <option value="">All</option>
        ${optionHtml}
      </select>
    </div>
    ${!options ? `
    <script>
      (function(){
        var allData=[];
        for(var id in window.__DATA||{}){allData=allData.concat(window.__DATA[id])}
        var vals=[],seen={};
        allData.forEach(function(r){
          var v=r['${escapeAttr(field)}'];
          if(v!=null&&!seen[v]){seen[v]=1;vals.push(String(v))}
        });
        vals.sort();
        var sel=document.getElementById('filter-${escapeAttr(field)}');
        if(sel){vals.forEach(function(v){
          var opt=document.createElement('option');
          opt.value=v;opt.textContent=v;sel.appendChild(opt);
        })}
      })();
    </script>
    ` : ''}
  `;
}
