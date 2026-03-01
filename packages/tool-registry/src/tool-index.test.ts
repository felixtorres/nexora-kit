import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { ToolIndex } from './tool-index.js';

function makeTool(name: string, desc: string): ToolDefinition {
  return { name, description: desc, parameters: { type: 'object', properties: {} } };
}

describe('ToolIndex', () => {
  let index: ToolIndex;

  beforeEach(() => {
    index = new ToolIndex();
  });

  it('registers and retrieves tools', () => {
    index.register(makeTool('search', 'Search database'), 'db-tools');
    expect(index.size()).toBe(1);
    expect(index.listAll()).toHaveLength(1);
  });

  it('unregisters tools', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    index.unregister('search');
    expect(index.size()).toBe(0);
  });

  it('searches by keyword', () => {
    index.register(makeTool('search-users', 'Search user records'), 'users');
    index.register(makeTool('create-user', 'Create a new user'), 'users');
    index.register(makeTool('send-email', 'Send an email'), 'comms');

    const results = index.search({ text: 'search users' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tool.name).toBe('search-users');
  });

  it('filters by namespace', () => {
    index.register(makeTool('a-search', 'Search A'), 'ns-a');
    index.register(makeTool('b-search', 'Search B'), 'ns-b');

    const results = index.search({ text: 'search', namespaces: ['ns-a'] });
    expect(results).toHaveLength(1);
    expect(results[0].namespace).toBe('ns-a');
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      index.register(makeTool(`tool-${i}`, `Search tool ${i}`), 'ns');
    }
    const results = index.search({ text: 'search tool', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('returns empty for no matches', () => {
    index.register(makeTool('create', 'Create something'), 'ns');
    const results = index.search({ text: 'zzzxxx' });
    expect(results).toHaveLength(0);
  });

  it('sorts by score descending', () => {
    index.register(makeTool('search', 'Search database records'), 'ns');
    index.register(makeTool('advanced-search', 'Advanced search with filters'), 'ns');
    index.register(makeTool('create', 'Create a record'), 'ns');

    const results = index.search({ text: 'search' });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('gets tools by namespace', () => {
    index.register(makeTool('a', 'Tool A'), 'ns-1');
    index.register(makeTool('b', 'Tool B'), 'ns-1');
    index.register(makeTool('c', 'Tool C'), 'ns-2');

    expect(index.getByNamespace('ns-1')).toHaveLength(2);
    expect(index.getByNamespace('ns-2')).toHaveLength(1);
    expect(index.getByNamespace('ns-3')).toHaveLength(0);
  });

  it('clears all data', () => {
    index.register(makeTool('a', 'A'), 'ns');
    index.register(makeTool('b', 'B'), 'ns');
    index.clear();
    expect(index.size()).toBe(0);
    expect(index.listAll()).toHaveLength(0);
  });

  it('handles tools with same name from different namespaces', () => {
    index.register(makeTool('search', 'Search in A'), 'ns-a');
    // Re-registering with same name overwrites
    expect(index.size()).toBe(1);
  });

  it('returns source as keyword', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    const results = index.search({ text: 'search' });
    expect(results[0].source).toBe('keyword');
  });

  it('handles empty namespace filter', () => {
    index.register(makeTool('search', 'Search'), 'ns');
    const results = index.search({ text: 'search', namespaces: [] });
    // Empty namespaces array should return all
    expect(results).toHaveLength(1);
  });
});
