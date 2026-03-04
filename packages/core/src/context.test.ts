import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './context.js';
import type { Conversation } from './types.js';

function createConversation(messages: Conversation['messages'] = []): Conversation {
  return {
    id: 'test-conv',
    teamId: 'team-a',
    userId: 'user-1',
    title: null,
    pluginNamespaces: [],
    messages,
    messageCount: messages.length,
    lastMessageAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager({ defaultSystemPrompt: 'You are helpful.' });
  });

  describe('assemble', () => {
    it('creates context with system prompt and messages', () => {
      const conv = createConversation([{ role: 'user', content: 'Hello' }]);
      const ctx = cm.assemble(conv, []);
      expect(ctx.systemPrompt).toBe('You are helpful.');
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.tools).toEqual([]);
    });

    it('includes tools in context', () => {
      const conv = createConversation();
      const tools = [
        {
          name: 'test',
          description: 'Test tool',
          parameters: { type: 'object' as const, properties: {} },
        },
      ];
      const ctx = cm.assemble(conv, tools);
      expect(ctx.tools).toHaveLength(1);
    });

    it('uses custom system prompt when provided', () => {
      const conv = createConversation();
      const ctx = cm.assemble(conv, [], 'Custom prompt');
      expect(ctx.systemPrompt).toBe('Custom prompt');
    });

    it('does not mutate conversation messages', () => {
      const conv = createConversation([{ role: 'user', content: 'Hello' }]);
      const ctx = cm.assemble(conv, []);
      ctx.messages.push({ role: 'assistant', content: 'Hi!' });
      expect(conv.messages).toHaveLength(1);
    });
  });

  describe('append', () => {
    it('appends message to conversation', () => {
      const conv = createConversation();
      cm.append(conv, { role: 'user', content: 'Hello' });
      expect(conv.messages).toHaveLength(1);
    });

    it('updates conversation updatedAt', () => {
      const conv = createConversation();
      const before = conv.updatedAt;
      cm.append(conv, { role: 'user', content: 'Hello' });
      expect(conv.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('truncate', () => {
    it('does nothing when under limit', () => {
      const conv = createConversation([{ role: 'user', content: 'Hi' }]);
      cm.truncate(conv, 1000);
      expect(conv.messages).toHaveLength(1);
    });

    it('removes oldest non-system messages when over limit', () => {
      const messages = Array.from({ length: 20 }, () => ({
        role: 'user' as const,
        content: 'x'.repeat(100),
      }));
      const conv = createConversation(messages);
      cm.truncate(conv, 100); // very low token limit
      expect(conv.messages.length).toBeLessThan(20);
    });

    it('preserves system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'Be helpful' },
        ...Array.from({ length: 20 }, () => ({ role: 'user' as const, content: 'x'.repeat(100) })),
      ];
      const conv = createConversation(messages);
      cm.truncate(conv, 100);
      expect(conv.messages[0].role).toBe('system');
    });

    it('never leaves a tool message without its preceding assistant tool_call', () => {
      // assistant(tool_calls) + tool + tool, then user + assistant(text)
      const messages = [
        { role: 'user' as const, content: 'x'.repeat(200) },
        {
          role: 'assistant' as const,
          content: [{ type: 'tool_use' as const, id: 'call_1', name: 'my_tool', input: {} }],
        },
        {
          role: 'tool' as const,
          content: [
            { type: 'tool_result' as const, toolUseId: 'call_1', content: 'x'.repeat(200) },
          ],
        },
        { role: 'user' as const, content: 'follow up' },
        { role: 'assistant' as const, content: 'final answer' },
      ];
      const conv = createConversation(messages);

      // Tight limit forces truncation
      cm.truncate(conv, 50);

      // No tool message should appear without a preceding assistant message with tool_calls
      for (let i = 0; i < conv.messages.length; i++) {
        if (conv.messages[i].role === 'tool') {
          const prev = conv.messages[i - 1];
          expect(prev).toBeDefined();
          expect(prev.role).toBe('assistant');
          expect(Array.isArray(prev.content)).toBe(true);
          const hasToolUse = (prev.content as any[]).some((c: any) => c.type === 'tool_use');
          expect(hasToolUse).toBe(true);
        }
      }
    });

    it('drops the entire assistant+tool group atomically', () => {
      // Two tool-call groups: drop the first one atomically
      const group1: Conversation['messages'] = [
        {
          role: 'assistant' as const,
          content: [{ type: 'tool_use' as const, id: 'call_1', name: 'tool_a', input: {} }],
        },
        {
          role: 'tool' as const,
          content: [
            { type: 'tool_result' as const, toolUseId: 'call_1', content: 'x'.repeat(400) },
          ],
        },
      ];
      const group2: Conversation['messages'] = [
        {
          role: 'assistant' as const,
          content: [{ type: 'tool_use' as const, id: 'call_2', name: 'tool_b', input: {} }],
        },
        {
          role: 'tool' as const,
          content: [{ type: 'tool_result' as const, toolUseId: 'call_2', content: 'result' }],
        },
      ];
      const messages: Conversation['messages'] = [
        { role: 'user' as const, content: 'question' },
        ...group1,
        ...group2,
      ];
      const conv = createConversation(messages);

      // Limit that forces dropping group1 but can fit group2
      cm.truncate(conv, 10);

      // group1's tool result must NOT be present without group1's assistant
      const toolMessages = conv.messages.filter((m) => m.role === 'tool');
      for (const toolMsg of toolMessages) {
        const idx = conv.messages.indexOf(toolMsg);
        expect(idx).toBeGreaterThan(0);
        const prev = conv.messages[idx - 1];
        expect(prev.role).toBe('assistant');
      }
    });
  });
});
