import { describe, it, expect } from 'vitest';
import { truncateToolResult, estimateTokens } from './token-utils.js';

describe('truncateToolResult', () => {
  it('returns content unchanged when under budget', () => {
    const content = 'Short result';
    expect(truncateToolResult(content, 100)).toBe(content);
  });

  it('truncates long content at line boundary', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: some data here`);
    const content = lines.join('\n');
    const result = truncateToolResult(content, 50);

    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain('[Truncated:');
    expect(result).toContain('chars total]');
  });

  it('truncates at maxChars when no newline found', () => {
    const content = 'a'.repeat(1000); // no newlines
    const result = truncateToolResult(content, 50); // 50 * 4 = 200 chars max
    expect(result).toContain('[Truncated: 1000 chars total]');
  });

  it('handles empty content', () => {
    expect(truncateToolResult('', 100)).toBe('');
  });

  it('handles exact budget boundary', () => {
    const content = 'x'.repeat(400); // 400 chars = 100 tokens
    expect(truncateToolResult(content, 100)).toBe(content);
  });

  it('truncation notice includes total length', () => {
    const content = 'x'.repeat(10000);
    const result = truncateToolResult(content, 100);
    expect(result).toContain('[Truncated: 10000 chars total]');
  });
});

describe('estimateTokens', () => {
  it('estimates tokens using char/4 heuristic', () => {
    expect(estimateTokens('abcdefgh')).toBe(2); // 8 / 4 = 2
    expect(estimateTokens('abc')).toBe(1); // ceil(3/4) = 1
    expect(estimateTokens('')).toBe(0);
  });
});
