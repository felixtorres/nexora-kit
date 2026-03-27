/**
 * Export button control template.
 */

export function renderExportButton(formats: ('png' | 'csv')[]): string {
  const hasPng = formats.includes('png');
  const hasCsv = formats.includes('csv');

  const buttons: string[] = [];
  if (hasPng) {
    buttons.push(
      `<button class="btn-sm" onclick="window.__exportAll()" title="Export all charts as PNG">&#8615; PNG</button>`,
    );
  }
  if (hasCsv) {
    buttons.push(
      `<button class="btn-sm" onclick="(function(){for(var id in window.__widgets){if(window.__widgets[id].type==='table')window.__exportTableCsv(id)}})()" title="Export all tables as CSV">&#8615; CSV</button>`,
    );
  }

  return buttons.join('\n');
}
