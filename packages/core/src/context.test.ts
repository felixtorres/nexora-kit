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
      const tools = [{ name: 'test', description: 'Test tool', parameters: { type: 'object' as const, properties: {} } }];
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
  });
});
