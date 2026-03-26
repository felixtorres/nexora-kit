/**
 * Result parsers for tool-backed data adapters.
 *
 * Each parser converts the raw string (or ToolHandlerResponse) returned by a
 * tool invocation into a normalised TabularResult.
 */

import type { ToolHandlerResponse } from '@nexora-kit/core';
import type { TabularResult, ColumnInfo, ColumnType } from './types.js';

// ---------------------------------------------------------------------------
// Parser type
// ---------------------------------------------------------------------------

type Parser = (raw: string) => TabularResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferColumnType(value: unknown): ColumnType {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') {
    // ISO-8601 date check (loose)
    if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(value)) return 'date';
  }
  return 'string';
}

function columnsFromObject(row: Record<string, unknown>): ColumnInfo[] {
  return Object.entries(row).map(([key, value]) => ({
    key,
    label: key,
    type: inferColumnType(value),
  }));
}

// ---------------------------------------------------------------------------
// tabular parser — expects { columns: [...], rows: [...] }
// ---------------------------------------------------------------------------

const tabularParser: Parser = (raw: string): TabularResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('tabular parser: input is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('tabular parser: expected a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.columns)) {
    throw new Error('tabular parser: missing or invalid "columns" array');
  }

  if (!Array.isArray(obj.rows)) {
    throw new Error('tabular parser: missing or invalid "rows" array');
  }

  const columns: ColumnInfo[] = (obj.columns as unknown[]).map((c) => {
    if (typeof c === 'string') {
      return { key: c, label: c, type: 'unknown' as ColumnType };
    }
    const col = c as Record<string, unknown>;
    return {
      key: String(col.key ?? col.name ?? ''),
      label: String(col.label ?? col.key ?? col.name ?? ''),
      type: (col.type as ColumnType) ?? 'unknown',
    };
  });

  const rows = obj.rows as Record<string, unknown>[];

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: Boolean(obj.truncated),
  };
};

// ---------------------------------------------------------------------------
// json-array parser — expects [{...}, {...}], infers columns from first row
// ---------------------------------------------------------------------------

const jsonArrayParser: Parser = (raw: string): TabularResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('json-array parser: input is not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('json-array parser: expected a JSON array');
  }

  const rows = parsed as Record<string, unknown>[];

  if (rows.length === 0) {
    return { columns: [], rows: [], rowCount: 0, truncated: false };
  }

  const columns = columnsFromObject(rows[0]);

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: false,
  };
};

// ---------------------------------------------------------------------------
// csv-text parser — header row + data rows
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current.trim());
  return fields;
}

const csvTextParser: Parser = (raw: string): TabularResult => {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0, truncated: false };
  }

  const headers = parseCsvLine(lines[0]);
  const columns: ColumnInfo[] = headers.map((h) => ({
    key: h,
    label: h,
    type: 'string' as ColumnType,
  }));

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const value = values[j] ?? '';
      // Try to coerce obvious numbers
      const num = Number(value);
      row[headers[j]] = value !== '' && !isNaN(num) ? num : value;
    }
    rows.push(row);
  }

  // Re-infer column types from first data row if available
  if (rows.length > 0) {
    for (const col of columns) {
      col.type = inferColumnType(rows[0][col.key]);
    }
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: false,
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const parsers = new Map<string, Parser>([
  ['tabular', tabularParser],
  ['json-array', jsonArrayParser],
  ['csv-text', csvTextParser],
]);

export const ResultParserRegistry = {
  get(format: string): Parser | undefined {
    return parsers.get(format);
  },

  has(format: string): boolean {
    return parsers.has(format);
  },

  register(format: string, parser: Parser): void {
    parsers.set(format, parser);
  },

  formats(): string[] {
    return [...parsers.keys()];
  },
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseToolResult(
  raw: string | ToolHandlerResponse,
  format: string,
): TabularResult {
  const text = typeof raw === 'string' ? raw : raw.content;

  const parser = parsers.get(format);
  if (!parser) {
    throw new Error(
      `Unknown result format '${format}'. Available: ${[...parsers.keys()].join(', ')}`,
    );
  }

  return parser(text);
}
