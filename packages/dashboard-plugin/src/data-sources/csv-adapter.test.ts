import { describe, it, expect } from 'vitest';
import { CsvAdapter } from './csv-adapter.js';
import type { QueryConstraints } from './types.js';

const DEFAULT_CONSTRAINTS: QueryConstraints = {
  maxRows: 10_000,
  timeoutMs: 30_000,
};

const SIMPLE_CSV = `name,age,score
Alice,30,95.5
Bob,25,88.0
Charlie,35,92.3`;

describe('CsvAdapter', () => {
  describe('schema detection', () => {
    it('detects string and number columns from simple CSV', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe('test');
      expect(schema.tables[0].columns).toHaveLength(3);

      const [name, age, score] = schema.tables[0].columns;
      expect(name.name).toBe('name');
      expect(name.type).toBe('string');
      expect(age.name).toBe('age');
      expect(age.type).toBe('number');
      expect(score.name).toBe('score');
      expect(score.type).toBe('number');
    });

    it('detects boolean columns', async () => {
      const csv = `flag,label\ntrue,a\nfalse,b\ntrue,c`;
      const adapter = new CsvAdapter('bools', csv, DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      const flagCol = schema.tables[0].columns.find((c) => c.name === 'flag');
      expect(flagCol!.type).toBe('boolean');
    });

    it('detects date columns from ISO strings', async () => {
      const csv = `event,date\nlaunch,2026-03-25T10:00:00Z\nrelease,2026-04-01`;
      const adapter = new CsvAdapter('dates', csv, DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      const dateCol = schema.tables[0].columns.find((c) => c.name === 'date');
      expect(dateCol!.type).toBe('date');
    });

    it('reports row count estimate in schema', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      expect(schema.tables[0].rowCountEstimate).toBe(3);
    });

    it('uses custom table name when provided', async () => {
      const adapter = new CsvAdapter('src-id', SIMPLE_CSV, DEFAULT_CONSTRAINTS, 'sales_data');
      const schema = await adapter.introspectSchema();

      expect(schema.tables[0].name).toBe('sales_data');
    });
  });

  describe('getSampleData', () => {
    it('returns first N rows', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test', 2);

      expect(result.rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
      expect(result.rows[0]).toEqual({ name: 'Alice', age: 30, score: 95.5 });
      expect(result.rows[1]).toEqual({ name: 'Bob', age: 25, score: 88.0 });
      expect(result.truncated).toBe(true);
    });

    it('defaults to 5 rows', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test');

      // Only 3 data rows exist
      expect(result.rows).toHaveLength(3);
      expect(result.truncated).toBe(false);
    });

    it('returns correct column metadata', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test', 1);

      expect(result.columns).toHaveLength(3);
      expect(result.columns[0]).toEqual({ key: 'name', label: 'name', type: 'string' });
      expect(result.columns[1]).toEqual({ key: 'age', label: 'age', type: 'number' });
      expect(result.columns[2]).toEqual({ key: 'score', label: 'score', type: 'number' });
    });
  });

  describe('execute', () => {
    it('returns all rows when no LIMIT', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.execute('SELECT * FROM test');

      expect(result.rows).toHaveLength(3);
      expect(result.rowCount).toBe(3);
      expect(result.truncated).toBe(false);
    });

    it('respects LIMIT clause in query', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.execute('SELECT * FROM test LIMIT 2');

      expect(result.rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it('respects case-insensitive LIMIT', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);
      const result = await adapter.execute('SELECT * FROM test limit 1');

      expect(result.rows).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });

    it('caps LIMIT at maxRows constraint', async () => {
      const constraints: QueryConstraints = { maxRows: 2, timeoutMs: 5000 };
      const adapter = new CsvAdapter('test', SIMPLE_CSV, constraints);
      const result = await adapter.execute('SELECT * FROM test LIMIT 100');

      expect(result.rows).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('applies maxRows when no LIMIT given', async () => {
      const constraints: QueryConstraints = { maxRows: 1, timeoutMs: 5000 };
      const adapter = new CsvAdapter('test', SIMPLE_CSV, constraints);
      const result = await adapter.execute('SELECT * FROM test');

      expect(result.rows).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });
  });

  describe('CSV parsing edge cases', () => {
    it('handles quoted fields with commas', async () => {
      const csv = `name,city\n"Smith, John","New York"`;
      const adapter = new CsvAdapter('test', csv, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test');

      expect(result.rows[0].name).toBe('Smith, John');
      expect(result.rows[0].city).toBe('New York');
    });

    it('handles escaped quotes in quoted fields', async () => {
      const csv = `value\n"He said ""hello"""`;
      const adapter = new CsvAdapter('test', csv, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test');

      expect(result.rows[0].value).toBe('He said "hello"');
    });

    it('handles empty CSV (no content)', async () => {
      const adapter = new CsvAdapter('empty', '', DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      expect(schema.tables[0].columns).toEqual([]);
      expect(schema.tables[0].rowCountEstimate).toBe(0);

      const result = await adapter.getSampleData('empty');
      expect(result.rows).toEqual([]);
    });

    it('handles header-only CSV (no data rows)', async () => {
      const csv = `a,b,c`;
      const adapter = new CsvAdapter('test', csv, DEFAULT_CONSTRAINTS);
      const schema = await adapter.introspectSchema();

      expect(schema.tables[0].columns).toHaveLength(3);
      expect(schema.tables[0].rowCountEstimate).toBe(0);

      const result = await adapter.getSampleData('test');
      expect(result.rows).toEqual([]);
    });

    it('coerces boolean values', async () => {
      const csv = `flag\ntrue\nfalse`;
      const adapter = new CsvAdapter('test', csv, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test');

      expect(result.rows[0].flag).toBe(true);
      expect(result.rows[1].flag).toBe(false);
    });

    it('coerces null for empty values', async () => {
      const csv = `name,age\nAlice,30\nBob,`;
      const adapter = new CsvAdapter('test', csv, DEFAULT_CONSTRAINTS);
      const result = await adapter.getSampleData('test');

      expect(result.rows[1].age).toBe(null);
    });
  });

  describe('row limit enforcement', () => {
    it('rejects CSV with more than 100K rows', () => {
      // Build a CSV with 100,001 data rows
      const header = 'id,value';
      const lines = [header];
      for (let i = 0; i < 100_001; i++) {
        lines.push(`${i},${i * 10}`);
      }
      const bigCsv = lines.join('\n');

      expect(() => new CsvAdapter('big', bigCsv, DEFAULT_CONSTRAINTS)).toThrow(
        /exceeds maximum row limit.*100,000/,
      );
    });
  });

  describe('close', () => {
    it('clears internal data', async () => {
      const adapter = new CsvAdapter('test', SIMPLE_CSV, DEFAULT_CONSTRAINTS);

      // Verify data exists
      let result = await adapter.getSampleData('test');
      expect(result.rows).toHaveLength(3);

      await adapter.close();

      // After close, data should be cleared
      result = await adapter.getSampleData('test');
      expect(result.rows).toEqual([]);
    });
  });
});
