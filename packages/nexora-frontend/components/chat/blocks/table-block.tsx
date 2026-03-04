'use client';

import type { TableBlock as TableBlockType } from '@/lib/block-types';

export function TableBlock({ block }: { block: TableBlockType }) {
  if (block.rows.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No rows returned.</p>;
  }

  // Derive columns: prefer explicit column definitions, fall back to row keys
  const cols =
    block.columns.length > 0
      ? block.columns
      : Object.keys(block.rows[0]).map((k) => ({ key: k, label: k }));

  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {cols.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              {cols.map((col) => {
                const val = row[col.key];
                return (
                  <td key={col.key} className="px-3 py-2 text-foreground">
                    {val === null || val === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      String(val)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
        {block.rows.length} row{block.rows.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
