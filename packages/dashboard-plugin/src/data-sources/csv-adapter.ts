/**
 * Built-in CSV data adapter.
 *
 * Parses raw CSV content into an in-memory tabular store.
 * Schema is auto-detected from the header row and first 100 data rows.
 * No external dependencies — uses the CSV parser from result-parsers.ts.
 */

import type {
  DataAdapter,
  TabularResult,
  DataSourceSchema,
  ColumnInfo,
  ColumnType,
  ColumnSchema,
  QueryConstraints,
} from './types.js';

const MAX_ROWS = 100_000;
const SCHEMA_SAMPLE_SIZE = 100;

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
          i++;
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

function detectColumnType(values: unknown[]): ColumnType {
  let hasNumber = false;
  let hasBoolean = false;
  let hasDate = false;
  let hasString = false;
  let checked = 0;

  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    checked++;

    const str = String(value);

    // Try number
    if (!isNaN(Number(str)) && str !== '') {
      hasNumber = true;
      continue;
    }

    // Try boolean
    if (str === 'true' || str === 'false') {
      hasBoolean = true;
      continue;
    }

    // Try date (ISO-8601 loose)
    if (/^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(str)) {
      hasDate = true;
      continue;
    }

    hasString = true;
  }

  if (checked === 0) return 'unknown';
  if (hasString) return 'string';
  if (hasNumber && !hasBoolean && !hasDate) return 'number';
  if (hasBoolean && !hasNumber && !hasDate) return 'boolean';
  if (hasDate && !hasNumber && !hasBoolean) return 'date';
  return 'string';
}

function coerceValue(value: string, type: ColumnType): unknown {
  if (value === '') return null;

  switch (type) {
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? value : n;
    }
    case 'boolean':
      return value === 'true';
    case 'date':
      return value;
    default:
      return value;
  }
}

export class CsvAdapter implements DataAdapter {
  readonly id: string;
  readonly type = 'built-in' as const;
  private headers: string[] = [];
  private rows: Record<string, unknown>[] = [];
  private columnTypes: Map<string, ColumnType> = new Map();
  private readonly constraints: QueryConstraints;
  private readonly tableName: string;

  constructor(id: string, csvContent: string, constraints: QueryConstraints, tableName?: string) {
    this.id = id;
    this.constraints = constraints;
    this.tableName = tableName ?? id;
    this.parse(csvContent);
  }

  private parse(csvContent: string): void {
    const lines = csvContent.split('\n').filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      this.headers = [];
      this.rows = [];
      return;
    }

    this.headers = parseCsvLine(lines[0]);

    // Check row count before parsing (lines minus header)
    const dataLineCount = lines.length - 1;
    if (dataLineCount > MAX_ROWS) {
      throw new Error(
        `CSV exceeds maximum row limit: ${dataLineCount} rows (max ${MAX_ROWS.toLocaleString()})`,
      );
    }

    // First pass: parse raw string values for type detection (sample first N rows)
    const sampleSize = Math.min(dataLineCount, SCHEMA_SAMPLE_SIZE);
    const sampleValues = new Map<string, string[]>();
    for (const h of this.headers) {
      sampleValues.set(h, []);
    }

    for (let i = 1; i <= sampleSize; i++) {
      const values = parseCsvLine(lines[i]);
      for (let j = 0; j < this.headers.length; j++) {
        sampleValues.get(this.headers[j])!.push(values[j] ?? '');
      }
    }

    // Detect types from sample
    for (const [header, values] of sampleValues) {
      this.columnTypes.set(header, detectColumnType(values));
    }

    // Second pass: parse all rows with type coercion
    this.rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row: Record<string, unknown> = {};
      for (let j = 0; j < this.headers.length; j++) {
        const header = this.headers[j];
        const type = this.columnTypes.get(header) ?? 'string';
        row[header] = coerceValue(values[j] ?? '', type);
      }
      this.rows.push(row);
    }
  }

  async introspectSchema(): Promise<DataSourceSchema> {
    const columns: ColumnSchema[] = this.headers.map((h) => ({
      name: h,
      type: this.columnTypes.get(h) ?? 'string',
      nullable: this.rows.some((r) => r[h] === null || r[h] === undefined),
    }));

    return {
      tables: [
        {
          name: this.tableName,
          columns,
          rowCountEstimate: this.rows.length,
        },
      ],
    };
  }

  async execute(query: string, _params?: Record<string, unknown>): Promise<TabularResult> {
    // Simple query engine: extract LIMIT clause, return rows
    const limitMatch = query.match(/\bLIMIT\s+(\d+)\b/i);
    const limit = limitMatch
      ? Math.min(parseInt(limitMatch[1], 10), this.constraints.maxRows)
      : this.constraints.maxRows;

    const resultRows = this.rows.slice(0, limit);
    const columns = this.buildColumnInfos();

    return {
      columns,
      rows: resultRows,
      rowCount: resultRows.length,
      truncated: resultRows.length < this.rows.length,
    };
  }

  async getSampleData(_table: string, limit = 5): Promise<TabularResult> {
    const resultRows = this.rows.slice(0, limit);
    const columns = this.buildColumnInfos();

    return {
      columns,
      rows: resultRows,
      rowCount: resultRows.length,
      truncated: resultRows.length < this.rows.length,
    };
  }

  async close(): Promise<void> {
    this.headers = [];
    this.rows = [];
    this.columnTypes.clear();
  }

  private buildColumnInfos(): ColumnInfo[] {
    return this.headers.map((h) => ({
      key: h,
      label: h,
      type: this.columnTypes.get(h) ?? 'string',
    }));
  }
}
