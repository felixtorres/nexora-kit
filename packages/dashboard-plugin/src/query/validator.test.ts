import { describe, it, expect } from 'vitest';
import { validateQuery } from './validator.js';
import type { QueryConstraints } from '../data-sources/types.js';

const defaults: QueryConstraints = {
  maxRows: 10_000,
  timeoutMs: 30_000,
};

describe('validateQuery', () => {
  describe('basic validation', () => {
    it('accepts a simple SELECT', () => {
      const result = validateQuery('SELECT * FROM users', defaults);
      expect(result.valid).toBe(true);
    });

    it('accepts WITH (CTE) queries', () => {
      const result = validateQuery('WITH cte AS (SELECT 1) SELECT * FROM cte', defaults);
      expect(result.valid).toBe(true);
    });

    it('rejects empty query', () => {
      const result = validateQuery('', defaults);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });
  });

  describe('write statement rejection', () => {
    it.each([
      ['INSERT INTO users VALUES (1)', 'INSERT'],
      ['UPDATE users SET name = \'x\'', 'UPDATE'],
      ['DELETE FROM users', 'DELETE'],
      ['DROP TABLE users', 'DROP'],
      ['ALTER TABLE users ADD COLUMN x int', 'ALTER'],
      ['TRUNCATE users', 'TRUNCATE'],
      ['CREATE TABLE x (id int)', 'CREATE'],
      ['GRANT SELECT ON users TO public', 'GRANT'],
    ])('rejects %s', (sql, keyword) => {
      const result = validateQuery(sql, defaults);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(keyword);
    });
  });

  describe('dangerous constructs', () => {
    it('rejects multi-statement queries', () => {
      const result = validateQuery('SELECT 1; DROP TABLE users', defaults);
      expect(result.valid).toBe(false);
    });

    it('rejects pg_sleep', () => {
      const result = validateQuery('SELECT pg_sleep(10)', defaults);
      expect(result.valid).toBe(false);
    });

    it('rejects queries not starting with SELECT/WITH', () => {
      const result = validateQuery('EXPLAIN SELECT 1', defaults);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with SELECT');
    });
  });

  describe('blocked columns', () => {
    const withBlocked: QueryConstraints = {
      ...defaults,
      blockedColumns: ['ssn', 'password'],
    };

    it('rejects SELECT * when blocked columns exist', () => {
      const result = validateQuery('SELECT * FROM users', withBlocked);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('SELECT *');
    });

    it('rejects query selecting a blocked column', () => {
      const result = validateQuery('SELECT name, ssn FROM users', withBlocked);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ssn');
    });

    it('accepts query without blocked columns', () => {
      const result = validateQuery('SELECT name, email FROM users', withBlocked);
      expect(result.valid).toBe(true);
    });
  });

  describe('allowed tables', () => {
    const withAllowed: QueryConstraints = {
      ...defaults,
      allowedTables: ['orders', 'products'],
    };

    it('accepts query referencing allowed tables', () => {
      const result = validateQuery('SELECT * FROM orders', withAllowed);
      expect(result.valid).toBe(true);
    });

    it('rejects query referencing disallowed table', () => {
      const result = validateQuery('SELECT * FROM users', withAllowed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('users');
    });

    it('rejects JOIN with disallowed table', () => {
      const result = validateQuery('SELECT * FROM orders JOIN users ON orders.user_id = users.id', withAllowed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('users');
    });

    it('accepts JOIN with allowed tables', () => {
      const result = validateQuery('SELECT * FROM orders JOIN products ON orders.product_id = products.id', withAllowed);
      expect(result.valid).toBe(true);
    });
  });
});
