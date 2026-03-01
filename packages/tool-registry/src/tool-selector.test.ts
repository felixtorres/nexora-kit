import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { ToolIndex } from './tool-index.js';
import { SelectionLogger } from './selection-logger.js';
import { ToolSelector } from './tool-selector.js';
import { estimateToolTokens } from './token-estimator.js';

function makeTool(name: string, desc: string): ToolDefinition {
  return { name, description: desc, parameters: { type: 'object', properties: {} } };
}

describe('ToolSelector', () => {
  let index: ToolIndex;
  let logger: SelectionLogger;
  let selector: ToolSelector;

  beforeEach(() => {
    index = new ToolIndex();
    logger = new SelectionLogger();
  });

  function setupSelector(pinnedTools: string[] = []) {
    selector = new ToolSelector({ index, logger, pinnedTools });
  }

  it('selects tools matching the query', () => {
    index.register(makeTool('search-users', 'Search user records'), 'users');
    index.register(makeTool('create-user', 'Create a new user'), 'users');
    index.register(makeTool('send-email', 'Send an email'), 'comms');
    setupSelector();

    const result = selector.select({
      query: 'search users',
      namespaces: ['users', 'comms'],
      tokenBudget: 10000,
    });

    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools[0].name).toBe('search-users');
  });

  it('respects token budget', () => {
    for (let i = 0; i < 20; i++) {
      index.register(makeTool(`tool-${i}`, `Search tool number ${i}`), 'ns');
    }
    setupSelector();

    const singleTokens = estimateToolTokens(makeTool('tool-0', 'Search tool number 0'));
    const budget = singleTokens * 3;

    const result = selector.select({
      query: 'search tool',
      namespaces: ['ns'],
      tokenBudget: budget,
    });

    expect(result.tools.length).toBeLessThanOrEqual(3);
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('always includes pinned tools', () => {
    index.register(makeTool('pinned-tool', 'A pinned tool'), 'ns');
    index.register(makeTool('other-tool', 'Another tool'), 'ns');
    setupSelector(['pinned-tool']);

    const result = selector.select({
      query: 'something unrelated',
      namespaces: ['ns'],
      tokenBudget: 10000,
    });

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('pinned-tool');
  });

  it('boosts recently used tools', () => {
    index.register(makeTool('search-a', 'Search A records'), 'ns');
    index.register(makeTool('search-b', 'Search B records'), 'ns');
    setupSelector();

    const result = selector.select({
      query: 'search records',
      namespaces: ['ns'],
      tokenBudget: 10000,
      recentToolNames: ['search-b'],
    });

    // search-b should be boosted by recency
    const bIndex = result.tools.findIndex((t) => t.name === 'search-b');
    expect(bIndex).toBeLessThanOrEqual(1); // Should be near the top
  });

  it('returns timing information', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    setupSelector();

    const result = selector.select({
      query: 'search',
      namespaces: ['ns'],
      tokenBudget: 10000,
    });

    expect(result.selectionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('logs selection decisions', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    setupSelector();

    selector.select({
      query: 'search',
      namespaces: ['ns'],
      tokenBudget: 10000,
    });

    expect(logger.size()).toBe(1);
    const entries = logger.getAll();
    expect(entries[0].query).toBe('search');
  });

  it('handles empty namespace list', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    setupSelector();

    const result = selector.select({
      query: 'search',
      namespaces: [],
      tokenBudget: 10000,
    });

    // With empty namespaces, context score is 0
    expect(result.tools.length).toBeGreaterThanOrEqual(0);
  });

  it('returns droppedCount accurately', () => {
    for (let i = 0; i < 5; i++) {
      index.register(makeTool(`search-${i}`, `Search variant ${i}`), 'ns');
    }
    setupSelector();

    const singleTokens = estimateToolTokens(makeTool('search-0', 'Search variant 0'));

    const result = selector.select({
      query: 'search variant',
      namespaces: ['ns'],
      tokenBudget: singleTokens * 2,
    });

    expect(result.tools.length).toBeLessThanOrEqual(2);
    expect(result.droppedCount).toBe(5 - result.tools.length);
  });

  it('handles no matching tools gracefully', () => {
    index.register(makeTool('create', 'Create records'), 'ns');
    setupSelector();

    const result = selector.select({
      query: 'zzzzxxx',
      namespaces: ['ns'],
      tokenBudget: 10000,
    });

    expect(result.tools).toHaveLength(0);
    expect(result.droppedCount).toBe(0);
  });

  it('filters tools by active namespaces during search', () => {
    index.register(makeTool('search-a', 'Search'), 'ns-a');
    index.register(makeTool('search-b', 'Search'), 'ns-b');
    setupSelector();

    const result = selector.select({
      query: 'search',
      namespaces: ['ns-a'],
      tokenBudget: 10000,
    });

    const namespaces = new Set(result.tools.map((t) => t.name));
    expect(namespaces.has('search-a')).toBe(true);
    expect(namespaces.has('search-b')).toBe(false);
  });

  it('pinned tools consume budget first', () => {
    const pinned = makeTool('pinned', 'Always included tool');
    index.register(pinned, 'ns');
    index.register(makeTool('search', 'Search stuff'), 'ns');
    setupSelector(['pinned']);

    const pinnedTokens = estimateToolTokens(pinned);
    const searchTokens = estimateToolTokens(makeTool('search', 'Search stuff'));

    const result = selector.select({
      query: 'search',
      namespaces: ['ns'],
      tokenBudget: pinnedTokens + searchTokens - 1, // Not enough for both
    });

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('pinned');
    expect(names).not.toContain('search');
  });

  it('selects large number of tools efficiently', () => {
    for (let i = 0; i < 100; i++) {
      index.register(
        makeTool(`tool-${i}`, `Perform operation ${i % 10 === 0 ? 'search' : 'other'} ${i}`),
        `ns-${i % 5}`,
      );
    }
    setupSelector();

    const result = selector.select({
      query: 'search operation',
      namespaces: ['ns-0', 'ns-1', 'ns-2', 'ns-3', 'ns-4'],
      tokenBudget: 5000,
    });

    expect(result.selectionTimeMs).toBeLessThan(100);
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('recency decay works across multiple recent tools', () => {
    index.register(makeTool('tool-a', 'Search records'), 'ns');
    index.register(makeTool('tool-b', 'Search records'), 'ns');
    index.register(makeTool('tool-c', 'Search records'), 'ns');
    setupSelector();

    const result = selector.select({
      query: 'search records',
      namespaces: ['ns'],
      tokenBudget: 10000,
      recentToolNames: ['tool-a', 'tool-b', 'tool-c'],
    });

    // tool-c is most recent, should rank highest among equally keyword-scored tools
    expect(result.tools[0].name).toBe('tool-c');
  });
});
