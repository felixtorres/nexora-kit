import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { ToolIndex, GLOBAL_NAMESPACE } from './tool-index.js';
import { ToolSelector } from './tool-selector.js';

function makeTool(name: string, desc: string): ToolDefinition {
  return { name, description: desc, parameters: { type: 'object', properties: {} } };
}

describe('GLOBAL_NAMESPACE', () => {
  it('is defined as __global__', () => {
    expect(GLOBAL_NAMESPACE).toBe('__global__');
  });
});

describe('ToolIndex global namespace', () => {
  let index: ToolIndex;

  beforeEach(() => {
    index = new ToolIndex();
  });

  it('includes global tools in namespace-filtered search', () => {
    index.register(makeTool('search', 'Search records'), 'ns-a');
    index.register(makeTool('get_skill_context', 'Get skill context'), GLOBAL_NAMESPACE);

    const results = index.search({ text: 'search skill', namespaces: ['ns-a'] });
    const names = results.map((r) => r.tool.name);
    expect(names).toContain('search');
    expect(names).toContain('get_skill_context');
  });

  it('includes global tools when no namespace filter', () => {
    index.register(makeTool('tool-a', 'Do A'), 'ns-a');
    index.register(makeTool('global-tool', 'Global tool'), GLOBAL_NAMESPACE);

    const results = index.search({ text: 'tool' });
    const names = results.map((r) => r.tool.name);
    expect(names).toContain('tool-a');
    expect(names).toContain('global-tool');
  });

  it('global tools bypass namespace filter for different namespace', () => {
    index.register(makeTool('ns-b-tool', 'Tool in B'), 'ns-b');
    index.register(makeTool('global-helper', 'Global helper tool'), GLOBAL_NAMESPACE);

    // Search only ns-a — should NOT include ns-b but SHOULD include global
    const results = index.search({ text: 'tool helper', namespaces: ['ns-a'] });
    const names = results.map((r) => r.tool.name);
    expect(names).not.toContain('ns-b-tool');
    expect(names).toContain('global-helper');
  });
});

describe('ToolSelector global namespace', () => {
  it('includes global tools in namespace-filtered selection', () => {
    const index = new ToolIndex();
    index.register(makeTool('plugin-search', 'Search in plugin'), 'plugin-a');
    index.register(makeTool('get_skill_context', 'Get skill context'), GLOBAL_NAMESPACE);

    const selector = new ToolSelector({ index });
    const result = selector.select({
      query: 'search skill context',
      namespaces: ['plugin-a'],
      tokenBudget: 10000,
    });

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('get_skill_context');
    expect(names).toContain('plugin-search');
  });

  it('includes global tools even when no keyword match via fallback', () => {
    const index = new ToolIndex();
    index.register(makeTool('my-tool', 'Do something specific'), 'ns-a');
    index.register(makeTool('get_skill_context', 'Load skill instructions'), GLOBAL_NAMESPACE);

    const selector = new ToolSelector({ index });
    const result = selector.select({
      query: 'do something specific',
      namespaces: ['ns-a'],
      tokenBudget: 10000,
    });

    // Global tool should still be included even if query doesn't match
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('get_skill_context');
  });
});
