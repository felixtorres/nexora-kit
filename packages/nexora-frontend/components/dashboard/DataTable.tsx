'use client';

import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface DataTableData {
  widgetId: string;
  title: string;
  columns: { key: string; label: string; format?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalRows: number;
  truncated: boolean;
  sortable: boolean;
  pageSize?: number;
}

interface DataTableProps {
  data: DataTableData;
}

type SortDirection = 'asc' | 'desc';

interface SortState {
  key: string;
  direction: SortDirection;
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const multiplier = direction === 'asc' ? 1 : -1;

  if (a == null && b == null) return 0;
  if (a == null) return multiplier;
  if (b == null) return -multiplier;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * multiplier;
  }

  return String(a).localeCompare(String(b)) * multiplier;
}

export function DataTable({ data }: DataTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort || !data.sortable) return data.rows;
    return [...data.rows].sort((a, b) =>
      compareValues(a[sort.key], b[sort.key], sort.direction),
    );
  }, [data.rows, data.sortable, sort]);

  function handleHeaderClick(key: string) {
    if (!data.sortable) return;
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.direction === 'asc'
          ? { key, direction: 'desc' }
          : null;
      }
      return { key, direction: 'asc' };
    });
  }

  if (data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{data.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">No rows returned.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{data.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {data.columns.map((col) => (
                  <th
                    key={col.key}
                    className={
                      'px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap' +
                      (data.sortable ? ' cursor-pointer select-none hover:text-foreground' : '')
                    }
                    onClick={() => handleHeaderClick(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {data.sortable && sort?.key === col.key && (
                        sort.direction === 'asc'
                          ? <ChevronUp className="size-3" />
                          : <ChevronDown className="size-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  {data.columns.map((col) => {
                    const val = row[col.key];
                    return (
                      <td key={col.key} className="px-3 py-2 text-foreground">
                        {val == null ? (
                          <span className="text-muted-foreground">&mdash;</span>
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
        </div>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Showing {data.rowCount} of {data.totalRows} row{data.totalRows !== 1 ? 's' : ''}
        {data.truncated && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            (truncated)
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
