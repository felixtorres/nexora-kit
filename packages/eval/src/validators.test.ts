import { describe, it, expect } from 'vitest';
import { runValidators } from './validators.js';
import type { CaseResult, Validator, CaseMetrics } from './types.js';

function makeCaseResult(overrides: Partial<CaseResult> = {}): CaseResult {
  const metrics: CaseMetrics = {
    latencyMs: 1000,
    timeToFirstTokenMs: 200,
    inputTokens: 500,
    outputTokens: 300,
    totalTokens: 800,
    turns: 3,
    toolCalls: 2,
    toolErrors: 0,
    toolCallDetails: [],
    tokensPerTurn: 267,
    firstTurnResolved: false,
    ...overrides.metrics,
  };
  return {
    caseId: 'test',
    caseName: 'Test Case',
    responseText: 'Hello world! The answer is 42.',
    wsEvents: [],
    metrics,
    validations: [],
    passed: true,
    ...overrides,
  };
}

describe('validators', () => {
  describe('contains', () => {
    it('passes when text is found', () => {
      const v: Validator = { type: 'contains', value: 'Hello' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('case insensitive by default', () => {
      const v: Validator = { type: 'contains', value: 'hello' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when case sensitive and wrong case', () => {
      const v: Validator = { type: 'contains', value: 'hello', caseSensitive: true };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });

    it('fails when text not found', () => {
      const v: Validator = { type: 'contains', value: 'goodbye' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('not_contains', () => {
    it('passes when text is absent', () => {
      const v: Validator = { type: 'not_contains', value: 'goodbye' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when text is present', () => {
      const v: Validator = { type: 'not_contains', value: 'Hello' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('regex', () => {
    it('passes when pattern matches', () => {
      const v: Validator = { type: 'regex', pattern: '\\d+' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when pattern does not match', () => {
      const v: Validator = { type: 'regex', pattern: '^\\d+$' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });

    it('supports flags', () => {
      const v: Validator = { type: 'regex', pattern: 'HELLO', flags: 'i' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });
  });

  describe('json_valid', () => {
    it('passes for valid JSON', () => {
      const v: Validator = { type: 'json_valid' };
      const result = runValidators([v], makeCaseResult({ responseText: '{"key": "value"}' }));
      expect(result[0].passed).toBe(true);
    });

    it('fails for invalid JSON', () => {
      const v: Validator = { type: 'json_valid' };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('max_tokens', () => {
    it('passes when under limit', () => {
      const v: Validator = { type: 'max_tokens', limit: 1000 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when over limit', () => {
      const v: Validator = { type: 'max_tokens', limit: 500 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('max_turns', () => {
    it('passes when under limit', () => {
      const v: Validator = { type: 'max_turns', limit: 5 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when over limit', () => {
      const v: Validator = { type: 'max_turns', limit: 2 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('max_latency_ms', () => {
    it('passes when under limit', () => {
      const v: Validator = { type: 'max_latency_ms', limit: 2000 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
    });

    it('fails when over limit', () => {
      const v: Validator = { type: 'max_latency_ms', limit: 500 };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(false);
    });
  });

  describe('custom', () => {
    it('runs custom function', () => {
      const v: Validator = {
        type: 'custom',
        name: 'has-answer',
        fn: (r) => ({
          passed: r.responseText.includes('42'),
          message: 'checked for 42',
        }),
      };
      const result = runValidators([v], makeCaseResult());
      expect(result[0].passed).toBe(true);
      expect(result[0].message).toBe('checked for 42');
    });
  });

  describe('multiple validators', () => {
    it('runs all validators and reports each', () => {
      const validators: Validator[] = [
        { type: 'contains', value: 'Hello' },
        { type: 'max_tokens', limit: 500 },
      ];
      const results = runValidators(validators, makeCaseResult());
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });
  });
});
