import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteAgentBotBindingStore } from './agent-bot-binding-store.js';

describe('SqliteAgentBotBindingStore', () => {
  let db: Database.Database;
  let store: SqliteAgentBotBindingStore;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteAgentBotBindingStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('set()', () => {
    it('creates a new binding with defaults', () => {
      const binding = store.set({
        agentId: 'agent-1',
        botId: 'bot-1',
      });

      expect(binding.agentId).toBe('agent-1');
      expect(binding.botId).toBe('bot-1');
      expect(binding.priority).toBe(0);
      expect(binding.description).toBe('');
      expect(binding.keywords).toEqual([]);
    });

    it('creates a binding with all fields', () => {
      const binding = store.set({
        agentId: 'agent-1',
        botId: 'bot-1',
        priority: 10,
        description: 'Handles billing questions',
        keywords: ['billing', 'invoice', 'payment'],
      });

      expect(binding.priority).toBe(10);
      expect(binding.description).toBe('Handles billing questions');
      expect(binding.keywords).toEqual(['billing', 'invoice', 'payment']);
    });

    it('upserts on conflict (same agent_id + bot_id)', () => {
      store.set({
        agentId: 'agent-1',
        botId: 'bot-1',
        priority: 5,
        description: 'Original',
      });

      const updated = store.set({
        agentId: 'agent-1',
        botId: 'bot-1',
        priority: 10,
        description: 'Updated',
        keywords: ['new'],
      });

      expect(updated.priority).toBe(10);
      expect(updated.description).toBe('Updated');
      expect(updated.keywords).toEqual(['new']);

      const bindings = store.list('agent-1');
      expect(bindings).toHaveLength(1);
    });
  });

  describe('list()', () => {
    it('returns bindings sorted by priority DESC', () => {
      store.set({ agentId: 'agent-1', botId: 'bot-a', priority: 1 });
      store.set({ agentId: 'agent-1', botId: 'bot-b', priority: 10 });
      store.set({ agentId: 'agent-1', botId: 'bot-c', priority: 5 });

      const bindings = store.list('agent-1');
      expect(bindings).toHaveLength(3);
      expect(bindings[0].botId).toBe('bot-b');
      expect(bindings[1].botId).toBe('bot-c');
      expect(bindings[2].botId).toBe('bot-a');
    });

    it('only returns bindings for the given agent', () => {
      store.set({ agentId: 'agent-1', botId: 'bot-1' });
      store.set({ agentId: 'agent-2', botId: 'bot-2' });

      expect(store.list('agent-1')).toHaveLength(1);
      expect(store.list('agent-2')).toHaveLength(1);
    });

    it('returns empty array when no bindings exist', () => {
      expect(store.list('agent-1')).toEqual([]);
    });

    it('parses keywords JSON correctly', () => {
      store.set({
        agentId: 'agent-1',
        botId: 'bot-1',
        keywords: ['help', 'support'],
      });

      const bindings = store.list('agent-1');
      expect(bindings[0].keywords).toEqual(['help', 'support']);
    });
  });

  describe('remove()', () => {
    it('removes a specific binding and returns true', () => {
      store.set({ agentId: 'agent-1', botId: 'bot-1' });
      store.set({ agentId: 'agent-1', botId: 'bot-2' });

      expect(store.remove('agent-1', 'bot-1')).toBe(true);
      expect(store.list('agent-1')).toHaveLength(1);
      expect(store.list('agent-1')[0].botId).toBe('bot-2');
    });

    it('returns false when binding does not exist', () => {
      expect(store.remove('agent-1', 'bot-999')).toBe(false);
    });
  });

  describe('removeAll()', () => {
    it('removes all bindings for an agent and returns count', () => {
      store.set({ agentId: 'agent-1', botId: 'bot-1' });
      store.set({ agentId: 'agent-1', botId: 'bot-2' });
      store.set({ agentId: 'agent-1', botId: 'bot-3' });

      const count = store.removeAll('agent-1');
      expect(count).toBe(3);
      expect(store.list('agent-1')).toEqual([]);
    });

    it('does not affect other agents', () => {
      store.set({ agentId: 'agent-1', botId: 'bot-1' });
      store.set({ agentId: 'agent-2', botId: 'bot-2' });

      store.removeAll('agent-1');
      expect(store.list('agent-2')).toHaveLength(1);
    });

    it('returns 0 when no bindings exist', () => {
      expect(store.removeAll('agent-1')).toBe(0);
    });
  });
});
