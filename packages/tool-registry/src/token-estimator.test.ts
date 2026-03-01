import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { estimateToolTokens, estimateTotalTokens } from './token-estimator.js';

function makeTool(name: string, desc: string, props: Record<string, { type: string }> = {}): ToolDefinition {
  return {
    name,
    description: desc,
    parameters: { type: 'object', properties: props as ToolDefinition['parameters']['properties'] },
  };
}

describe('estimateToolTokens', () => {
  it('estimates tokens based on JSON length', () => {
    const tool = makeTool('search', 'Search things');
    const tokens = estimateToolTokens(tool);
    expect(tokens).toBeGreaterThan(0);
    // JSON is ~80 chars, so ~20 tokens
    expect(tokens).toBeLessThan(50);
  });

  it('increases with more properties', () => {
    const small = makeTool('a', 'Small');
    const large = makeTool('a', 'Large tool with many parameters', {
      query: { type: 'string' },
      limit: { type: 'number' },
      offset: { type: 'number' },
      sort: { type: 'string' },
    });
    expect(estimateToolTokens(large)).toBeGreaterThan(estimateToolTokens(small));
  });

  it('returns integer values', () => {
    const tool = makeTool('test', 'A tool');
    expect(Number.isInteger(estimateToolTokens(tool))).toBe(true);
  });
});

describe('estimateTotalTokens', () => {
  it('sums token estimates', () => {
    const tools = [makeTool('a', 'Tool A'), makeTool('b', 'Tool B')];
    const total = estimateTotalTokens(tools);
    expect(total).toBe(estimateToolTokens(tools[0]) + estimateToolTokens(tools[1]));
  });

  it('returns 0 for empty array', () => {
    expect(estimateTotalTokens([])).toBe(0);
  });
});
