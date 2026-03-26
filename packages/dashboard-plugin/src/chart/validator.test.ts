import { describe, it, expect } from 'vitest';
import { validateVegaLiteSpec } from './validator.js';

describe('validateVegaLiteSpec', () => {
  describe('single view specs', () => {
    it('accepts a valid bar chart spec', () => {
      const result = validateVegaLiteSpec({
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts mark as object with type', () => {
      const result = validateVegaLiteSpec({
        mark: { type: 'arc', innerRadius: 50 },
        encoding: {
          theta: { field: 'share', type: 'quantitative' },
          color: { field: 'segment', type: 'nominal' },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts spec with mark and no encoding', () => {
      // Some specs use mark only (e.g., rule)
      const result = validateVegaLiteSpec({
        mark: 'rule',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects unknown mark type (string)', () => {
      const result = validateVegaLiteSpec({
        mark: 'unknown_chart_type',
        encoding: {},
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown mark type');
    });

    it('rejects unknown mark type (object)', () => {
      const result = validateVegaLiteSpec({
        mark: { type: 'invalid' },
        encoding: {},
      });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid mark format', () => {
      const result = validateVegaLiteSpec({
        mark: 42,
        encoding: {},
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('mark');
    });
  });

  describe('encoding validation', () => {
    it('accepts valid encoding channels', () => {
      const result = validateVegaLiteSpec({
        mark: 'point',
        encoding: {
          x: { field: 'a', type: 'quantitative' },
          y: { field: 'b', type: 'quantitative' },
          color: { field: 'c', type: 'nominal' },
          tooltip: { field: 'd', type: 'nominal' },
          size: { field: 'e', type: 'quantitative' },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('rejects unknown encoding channel', () => {
      const result = validateVegaLiteSpec({
        mark: 'bar',
        encoding: {
          x: { field: 'a', type: 'nominal' },
          notAChannel: { field: 'b', type: 'quantitative' },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('notAChannel');
    });
  });

  describe('composite specs', () => {
    it('accepts layer spec', () => {
      const result = validateVegaLiteSpec({
        layer: [
          { mark: 'bar', encoding: { x: { field: 'a' }, y: { field: 'b' } } },
          { mark: 'line', encoding: { x: { field: 'a' }, y: { field: 'c' } } },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('rejects non-array layer', () => {
      const result = validateVegaLiteSpec({
        layer: 'not an array',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('missing structure', () => {
    it('rejects empty object', () => {
      const result = validateVegaLiteSpec({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('mark');
    });

    it('rejects object with only data', () => {
      const result = validateVegaLiteSpec({ data: { values: [] } });
      expect(result.valid).toBe(false);
    });
  });
});
