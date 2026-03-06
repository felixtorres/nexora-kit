import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolDefinition } from '@nexora-kit/core';
import { ToolIndex } from './tool-index.js';
import { ConversationToolMemory } from './conversation-tool-memory.js';
import {
  SEARCH_TOOLS_NAME,
  getSearchToolsDefinition,
  createSearchToolsHandler,
} from './search-tools-handler.js';

function makeTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {}, required: [] },
  };
}

describe('search-tools-handler', () => {
  describe('getSearchToolsDefinition', () => {
    it('returns a valid tool definition', () => {
      const def = getSearchToolsDefinition();
      expect(def.name).toBe(SEARCH_TOOLS_NAME);
      expect(def.parameters.properties).toHaveProperty('query');
    });
  });

  describe('createSearchToolsHandler', () => {
    let toolIndex: ToolIndex;
    let memory: ConversationToolMemory;
    let handler: ReturnType<typeof createSearchToolsHandler>;

    beforeEach(() => {
      toolIndex = new ToolIndex();
      memory = new ConversationToolMemory();
      handler = createSearchToolsHandler({
        toolIndex,
        conversationToolMemory: memory,
      });

      toolIndex.register(makeTool('sql_execute', 'Execute SQL queries on databases'), 'dbinsight');
      toolIndex.register(makeTool('sql_schema', 'View database schema'), 'dbinsight');
      toolIndex.register(makeTool('file_read', 'Read file contents'), 'filesystem');
    });

    it('returns matching tools', async () => {
      const result = await handler({ query: 'sql database' });
      expect(result).toContain('sql_execute');
    });

    it('records found tools in conversation memory', async () => {
      await handler({ query: 'sql database' }, { conversationId: 'conv-1' });
      const loaded = memory.getLoaded('conv-1');
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded).toContain('sql_execute');
    });

    it('does not record without conversationId', async () => {
      await handler({ query: 'sql database' });
      // No error, but nothing recorded (no conversation context)
      expect(memory.getLoaded('')).toEqual([]);
    });

    it('returns message when no tools match', async () => {
      const result = await handler({ query: 'quantum physics' });
      expect(result).toContain('No tools found');
    });

    it('returns message for empty query', async () => {
      const result = await handler({ query: '' });
      expect(result).toContain('provide a search query');
    });

    it('filters by namespace when provided', async () => {
      const result = await handler({ query: 'read', namespace: 'dbinsight' });
      expect(result).not.toContain('file_read');
    });
  });
});
