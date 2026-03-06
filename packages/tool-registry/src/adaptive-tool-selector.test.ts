import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { ToolIndex } from './tool-index.js';
import { ConversationToolMemory } from './conversation-tool-memory.js';
import { AdaptiveToolSelector } from './adaptive-tool-selector.js';
import { SEARCH_TOOLS_NAME } from './search-tools-handler.js';

function makeTool(name: string, description = 'A tool'): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {}, required: [] },
  };
}

function makeRequest(overrides = {}) {
  return {
    query: 'test query',
    namespaces: [] as string[],
    tokenBudget: 100_000,
    recentToolNames: [] as string[],
    ...overrides,
  };
}

describe('AdaptiveToolSelector', () => {
  let toolIndex: ToolIndex;
  let memory: ConversationToolMemory;

  beforeEach(() => {
    toolIndex = new ToolIndex();
    memory = new ConversationToolMemory();
  });

  describe('passthrough mode', () => {
    it('sends all tools when count is small and budget fits', () => {
      for (let i = 0; i < 10; i++) {
        toolIndex.register(makeTool(`tool-${i}`), 'ns');
      }

      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
      });

      const result = selector.select(makeRequest({ namespaces: ['ns'] }));
      expect(result.mode).toBe('passthrough');
      expect(result.tools).toHaveLength(10);
      expect(result.droppedCount).toBe(0);
    });

    it('includes all tools regardless of query relevance', () => {
      toolIndex.register(makeTool('sql_execute', 'Run SQL'), 'ns');
      toolIndex.register(makeTool('file_read', 'Read files'), 'ns');

      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
      });

      // Query doesn't mention SQL at all — tool should still be included
      const result = selector.select(makeRequest({ query: 'read the file', namespaces: ['ns'] }));
      expect(result.mode).toBe('passthrough');
      expect(result.tools.map((t) => t.name)).toContain('sql_execute');
    });
  });

  describe('search mode', () => {
    beforeEach(() => {
      // Register 50 tools to trigger search mode
      for (let i = 0; i < 50; i++) {
        toolIndex.register(makeTool(`tool-${i}`, `Tool number ${i}`), 'ns');
      }
    });

    it('switches to search mode when tool count exceeds threshold', () => {
      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
      });

      const result = selector.select(makeRequest({ namespaces: ['ns'] }));
      expect(result.mode).toBe('search');
    });

    it('includes _search_tools meta-tool', () => {
      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
      });

      const result = selector.select(makeRequest({ namespaces: ['ns'] }));
      expect(result.tools.map((t) => t.name)).toContain(SEARCH_TOOLS_NAME);
    });

    it('includes essential tools', () => {
      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
        essentialTools: ['tool-0', 'tool-1'],
      });

      const result = selector.select(makeRequest({ namespaces: ['ns'] }));
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('tool-0');
      expect(names).toContain('tool-1');
    });

    it('includes conversation-loaded tools', () => {
      memory.load('conv-1', ['tool-42']);

      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
      });

      const result = selector.select(
        makeRequest({ namespaces: ['ns'], conversationId: 'conv-1' }),
      );
      expect(result.tools.map((t) => t.name)).toContain('tool-42');
    });

    it('includes recently used tools', () => {
      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
      });

      const result = selector.select(
        makeRequest({ namespaces: ['ns'], recentToolNames: ['tool-49'] }),
      );
      expect(result.tools.map((t) => t.name)).toContain('tool-49');
    });

    it('respects token budget', () => {
      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 40,
      });

      // Very small budget — should still include _search_tools at minimum
      const result = selector.select(makeRequest({ namespaces: ['ns'], tokenBudget: 200 }));
      expect(result.tools.length).toBeLessThan(50);
      expect(result.tools.map((t) => t.name)).toContain(SEARCH_TOOLS_NAME);
    });
  });

  describe('threshold configuration', () => {
    it('uses custom threshold', () => {
      for (let i = 0; i < 15; i++) {
        toolIndex.register(makeTool(`tool-${i}`), 'ns');
      }

      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
        searchModeThreshold: 10,
      });

      const result = selector.select(makeRequest({ namespaces: ['ns'] }));
      expect(result.mode).toBe('search');
    });

    it('passthrough with empty namespaces lists all tools', () => {
      for (let i = 0; i < 5; i++) {
        toolIndex.register(makeTool(`tool-${i}`), 'ns');
      }

      const selector = new AdaptiveToolSelector({
        index: toolIndex,
        conversationToolMemory: memory,
      });

      const result = selector.select(makeRequest());
      expect(result.mode).toBe('passthrough');
      expect(result.tools).toHaveLength(5);
    });
  });
});
