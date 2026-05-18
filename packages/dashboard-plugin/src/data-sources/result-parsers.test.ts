import { describe, it, expect } from 'vitest';
import { parseToolResult, ResultParserRegistry } from './result-parsers.js';

// ---------------------------------------------------------------------------
// tabular parser
// ---------------------------------------------------------------------------

describe('tabular parser', () => {
  it('parses a well-formed tabular JSON object', () => {
    const raw = JSON.stringify({
      columns: [
        { key: 'id', label: 'ID', type: 'number' },
        { key: 'name', label: 'Name', type: 'string' },
      ],
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });

    const result = parseToolResult(raw, 'tabular');

    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]).toEqual({ key: 'id', label: 'ID', type: 'number' });
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('supports string-only column names', () => {
    const raw = JSON.stringify({
      columns: ['x', 'y'],
      rows: [{ x: 1, y: 2 }],
    });

    const result = parseToolResult(raw, 'tabular');
    // Types are inferred from first data row when columns are plain strings
    expect(result.columns[0]).toEqual({ key: 'x', label: 'x', type: 'number' });
    expect(result.columns[1]).toEqual({ key: 'y', label: 'y', type: 'number' });
  });

  it('preserves truncated flag when true', () => {
    const raw = JSON.stringify({
      columns: ['a'],
      rows: [{ a: 1 }],
      truncated: true,
    });

    const result = parseToolResult(raw, 'tabular');
    expect(result.truncated).toBe(true);
  });

  it('accepts ToolHandlerResponse objects', () => {
    const raw = {
      content: JSON.stringify({
        columns: ['x'],
        rows: [{ x: 10 }],
      }),
    };

    const result = parseToolResult(raw, 'tabular');
    expect(result.rows[0].x).toBe(10);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseToolResult('{not json', 'tabular')).toThrow('Could not parse');
  });

  it('falls back to json-array when columns array is missing', () => {
    const raw = JSON.stringify({ rows: [] });
    // Auto-detect wraps the single object in an array
    const result = parseToolResult(raw, 'tabular');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ rows: [] });
  });

  it('falls back to json-array when rows array is missing', () => {
    const raw = JSON.stringify({ columns: ['a'] });
    const result = parseToolResult(raw, 'tabular');
    expect(result.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// json-array parser
// ---------------------------------------------------------------------------

describe('json-array parser', () => {
  it('infers columns from first row', () => {
    const raw = JSON.stringify([
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
    ]);

    const result = parseToolResult(raw, 'json-array');

    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]).toEqual({ key: 'name', label: 'name', type: 'string' });
    expect(result.columns[1]).toEqual({ key: 'age', label: 'age', type: 'number' });
    expect(result.columns[2]).toEqual({ key: 'active', label: 'active', type: 'boolean' });
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('handles empty array', () => {
    const result = parseToolResult('[]', 'json-array');

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('falls back to wrapping single object in array', () => {
    const result = parseToolResult('{"a":1}', 'json-array');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ a: 1 });
  });

  it('throws on unparseable text', () => {
    expect(() => parseToolResult('not json', 'json-array')).toThrow('Could not parse');
  });

  it('infers date type from ISO strings', () => {
    const raw = JSON.stringify([
      { created: '2026-03-25T10:00:00Z', value: 42 },
    ]);

    const result = parseToolResult(raw, 'json-array');
    expect(result.columns[0].type).toBe('date');
    expect(result.columns[1].type).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// csv-text parser
// ---------------------------------------------------------------------------

describe('csv-text parser', () => {
  it('parses header + data rows', () => {
    const csv = 'name,age,score\nAlice,30,95.5\nBob,25,88.0';

    const result = parseToolResult(csv, 'csv-text');

    expect(result.columns).toHaveLength(3);
    expect(result.columns[0].key).toBe('name');
    expect(result.columns[1].key).toBe('age');
    expect(result.columns[2].key).toBe('score');
    // age and score should be inferred as numbers
    expect(result.columns[1].type).toBe('number');
    expect(result.columns[2].type).toBe('number');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: 'Alice', age: 30, score: 95.5 });
    expect(result.rowCount).toBe(2);
  });

  it('handles quoted fields with commas', () => {
    const csv = 'name,city\n"Smith, John","New York"';

    const result = parseToolResult(csv, 'csv-text');

    expect(result.rows[0].name).toBe('Smith, John');
    expect(result.rows[0].city).toBe('New York');
  });

  it('handles empty CSV', () => {
    const result = parseToolResult('', 'csv-text');

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('handles header-only CSV (no data rows)', () => {
    const result = parseToolResult('a,b,c', 'csv-text');

    expect(result.columns).toHaveLength(3);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('handles escaped quotes in CSV', () => {
    const csv = 'value\n"He said ""hello"""';

    const result = parseToolResult(csv, 'csv-text');
    expect(result.rows[0].value).toBe('He said "hello"');
  });
});

// ---------------------------------------------------------------------------
// kyvos parser
// ---------------------------------------------------------------------------

describe('kyvos parser', () => {
  it('parses Kyvos response with metadata.columns and array rows', () => {
    const raw = JSON.stringify({
      queryInfo: { natural_language_query: null, sql_query: 'SELECT ...' },
      metadata: {
        columns: [
          { caption: 'category', type: 'STRING' },
          { caption: 'total_sales', type: 'DOUBLE' },
          { caption: 'total_profit', type: 'DOUBLE' },
        ],
        misc: { sortInfo: {} },
      },
      rows: [
        ['Technology', '2893463.93', '398456.45'],
        ['Furniture', '2495779.24', '160693.96'],
        ['Office Supplies', '2316369.15', '319766.79'],
      ],
    });

    const result = parseToolResult(raw, 'kyvos');

    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]).toEqual({ key: 'category', label: 'category', type: 'string' });
    expect(result.columns[1]).toEqual({ key: 'total_sales', label: 'total_sales', type: 'number' });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      category: 'Technology',
      total_sales: 2893463.93,
      total_profit: 398456.45,
    });
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('coerces numeric strings to numbers', () => {
    const raw = JSON.stringify({
      metadata: {
        columns: [{ caption: 'value', type: 'DOUBLE' }],
      },
      rows: [['42.5'], ['0'], ['not-a-number']],
    });

    const result = parseToolResult(raw, 'kyvos');
    expect(result.rows[0].value).toBe(42.5);
    expect(result.rows[1].value).toBe(0);
    expect(result.rows[2].value).toBe('not-a-number');
  });

  it('handles empty result set', () => {
    const raw = JSON.stringify({
      metadata: { columns: [{ caption: 'x', type: 'STRING' }] },
      rows: [],
    });

    const result = parseToolResult(raw, 'kyvos');
    expect(result.columns).toHaveLength(1);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('auto-detects Kyvos format when configured as tabular', () => {
    const raw = JSON.stringify({
      metadata: {
        columns: [
          { caption: 'region', type: 'STRING' },
          { caption: 'sales', type: 'DOUBLE' },
        ],
      },
      rows: [['West', '100'], ['East', '200']],
    });

    // Even with 'tabular' format, fallback should detect Kyvos structure
    const result = parseToolResult(raw, 'tabular');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ region: 'West', sales: 100 });
  });
});

// ---------------------------------------------------------------------------
// Registry & error cases
// ---------------------------------------------------------------------------

describe('ResultParserRegistry', () => {
  it('lists all built-in formats', () => {
    const formats = ResultParserRegistry.formats();
    expect(formats).toContain('tabular');
    expect(formats).toContain('json-array');
    expect(formats).toContain('csv-text');
    expect(formats).toContain('kyvos');
  });

  it('has() returns true for known formats', () => {
    expect(ResultParserRegistry.has('tabular')).toBe(true);
    expect(ResultParserRegistry.has('nope')).toBe(false);
  });
});

describe('parseToolResult unknown format', () => {
  it('throws for unknown format', () => {
    expect(() => parseToolResult('{}', 'xml')).toThrow("Unknown result format 'xml'");
  });
});
