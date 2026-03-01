import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './context.js';
import type { Session } from './types.js';

function createSession(messages: Session['messages'] = []): Session {
  return {
    id: 'test-session',
    teamId: 'team-a',
    userId: 'user-1',
    pluginNamespaces: [],
    messages,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager({ defaultSystemPrompt: 'You are helpful.' });
  });

  describe('assemble', () => {
    it('creates context with system prompt and messages', () => {
      const session = createSession([{ role: 'user', content: 'Hello' }]);
      const ctx = cm.assemble(session, []);
      expect(ctx.systemPrompt).toBe('You are helpful.');
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.tools).toEqual([]);
    });

    it('includes tools in context', () => {
      const session = createSession();
      const tools = [{ name: 'test', description: 'Test tool', parameters: { type: 'object' as const, properties: {} } }];
      const ctx = cm.assemble(session, tools);
      expect(ctx.tools).toHaveLength(1);
    });

    it('uses custom system prompt when provided', () => {
      const session = createSession();
      const ctx = cm.assemble(session, [], 'Custom prompt');
      expect(ctx.systemPrompt).toBe('Custom prompt');
    });

    it('does not mutate session messages', () => {
      const session = createSession([{ role: 'user', content: 'Hello' }]);
      const ctx = cm.assemble(session, []);
      ctx.messages.push({ role: 'assistant', content: 'Hi!' });
      expect(session.messages).toHaveLength(1);
    });
  });

  describe('append', () => {
    it('appends message to session', () => {
      const session = createSession();
      cm.append(session, { role: 'user', content: 'Hello' });
      expect(session.messages).toHaveLength(1);
    });

    it('updates session updatedAt', () => {
      const session = createSession();
      const before = session.updatedAt;
      cm.append(session, { role: 'user', content: 'Hello' });
      expect(session.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('truncate', () => {
    it('does nothing when under limit', () => {
      const session = createSession([{ role: 'user', content: 'Hi' }]);
      cm.truncate(session, 1000);
      expect(session.messages).toHaveLength(1);
    });

    it('removes oldest non-system messages when over limit', () => {
      const messages = Array.from({ length: 20 }, () => ({
        role: 'user' as const,
        content: 'x'.repeat(100),
      }));
      const session = createSession(messages);
      cm.truncate(session, 100); // very low token limit
      expect(session.messages.length).toBeLessThan(20);
    });

    it('preserves system messages', () => {
      const messages = [
        { role: 'system' as const, content: 'Be helpful' },
        ...Array.from({ length: 20 }, () => ({ role: 'user' as const, content: 'x'.repeat(100) })),
      ];
      const session = createSession(messages);
      cm.truncate(session, 100);
      expect(session.messages[0].role).toBe('system');
    });
  });
});
