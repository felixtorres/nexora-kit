import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteBotStore } from './bot-store.js';

describe('SqliteBotStore', () => {
  let db: Database.Database;
  let store: SqliteBotStore;

  const teamId = 'team-1';

  const baseInput = {
    teamId,
    name: 'Support Bot',
    systemPrompt: 'You are a helpful support bot.',
    model: 'claude-sonnet-4-6',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteBotStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('returns a BotRecord with generated id and timestamps', () => {
      const bot = store.create(baseInput);

      expect(bot.id).toMatch(/^[0-9a-f]{8}-/);
      expect(bot.teamId).toBe(teamId);
      expect(bot.name).toBe('Support Bot');
      expect(bot.systemPrompt).toBe('You are a helpful support bot.');
      expect(bot.model).toBe('claude-sonnet-4-6');
      expect(bot.createdAt).toBeTruthy();
      expect(bot.updatedAt).toBe(bot.createdAt);
    });

    it('defaults description to empty string, optional fields to null', () => {
      const bot = store.create(baseInput);

      expect(bot.description).toBe('');
      expect(bot.pluginNamespaces).toEqual([]);
      expect(bot.temperature).toBeNull();
      expect(bot.maxTurns).toBeNull();
      expect(bot.workspaceId).toBeNull();
      expect(bot.metadata).toEqual({});
    });

    it('persists optional fields when provided', () => {
      const bot = store.create({
        ...baseInput,
        description: 'A customer support bot',
        pluginNamespaces: ['faq', 'kb'],
        temperature: 0.7,
        maxTurns: 5,
        workspaceId: 'ws-1',
        metadata: { tier: 'premium' },
      });

      expect(bot.description).toBe('A customer support bot');
      expect(bot.pluginNamespaces).toEqual(['faq', 'kb']);
      expect(bot.temperature).toBe(0.7);
      expect(bot.maxTurns).toBe(5);
      expect(bot.workspaceId).toBe('ws-1');
      expect(bot.metadata).toEqual({ tier: 'premium' });

      const fetched = store.get(bot.id, teamId);
      expect(fetched?.temperature).toBe(0.7);
      expect(fetched?.pluginNamespaces).toEqual(['faq', 'kb']);
    });

    it('enforces UNIQUE(team_id, name)', () => {
      store.create(baseInput);
      expect(() => store.create(baseInput)).toThrow();
    });

    it('allows same name for different teams', () => {
      store.create(baseInput);
      const bot2 = store.create({ ...baseInput, teamId: 'team-2' });
      expect(bot2.teamId).toBe('team-2');
    });
  });

  describe('get()', () => {
    it('returns bot by id and teamId', () => {
      const bot = store.create(baseInput);
      const fetched = store.get(bot.id, teamId);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(bot.id);
    });

    it('returns undefined for wrong teamId', () => {
      const bot = store.create(baseInput);
      expect(store.get(bot.id, 'team-other')).toBeUndefined();
    });

    it('returns undefined for nonexistent id', () => {
      expect(store.get('nonexistent', teamId)).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('returns bots for a team sorted by name', () => {
      store.create({ ...baseInput, name: 'Zebra Bot' });
      store.create({ ...baseInput, name: 'Alpha Bot' });
      store.create({ ...baseInput, name: 'Mid Bot' });

      const bots = store.list(teamId);
      expect(bots).toHaveLength(3);
      expect(bots[0].name).toBe('Alpha Bot');
      expect(bots[1].name).toBe('Mid Bot');
      expect(bots[2].name).toBe('Zebra Bot');
    });

    it('does not return bots from other teams', () => {
      store.create(baseInput);
      store.create({ ...baseInput, teamId: 'team-2', name: 'Other Bot' });

      expect(store.list(teamId)).toHaveLength(1);
      expect(store.list('team-2')).toHaveLength(1);
    });

    it('returns empty array when no bots exist', () => {
      expect(store.list(teamId)).toEqual([]);
    });
  });

  describe('update()', () => {
    it('updates name', () => {
      const bot = store.create(baseInput);
      const updated = store.update(bot.id, teamId, { name: 'New Name' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
    });

    it('updates model and systemPrompt', () => {
      const bot = store.create(baseInput);
      const updated = store.update(bot.id, teamId, {
        model: 'gpt-4',
        systemPrompt: 'Updated prompt',
      });

      expect(updated!.model).toBe('gpt-4');
      expect(updated!.systemPrompt).toBe('Updated prompt');
    });

    it('sets nullable fields to null', () => {
      const bot = store.create({ ...baseInput, temperature: 0.5, maxTurns: 3 });
      const updated = store.update(bot.id, teamId, {
        temperature: null,
        maxTurns: null,
      });

      expect(updated!.temperature).toBeNull();
      expect(updated!.maxTurns).toBeNull();
    });

    it('updates metadata', () => {
      const bot = store.create(baseInput);
      const updated = store.update(bot.id, teamId, {
        metadata: { lang: 'en' },
      });

      expect(updated!.metadata).toEqual({ lang: 'en' });
    });

    it('returns undefined for wrong teamId', () => {
      const bot = store.create(baseInput);
      expect(store.update(bot.id, 'team-other', { name: 'Hack' })).toBeUndefined();
    });

    it('sets updated_at to a newer timestamp', () => {
      const bot = store.create(baseInput);
      const updated = store.update(bot.id, teamId, { name: 'Changed' });

      expect(updated!.updatedAt >= bot.updatedAt).toBe(true);
    });
  });

  describe('delete()', () => {
    it('removes the bot and returns true', () => {
      const bot = store.create(baseInput);
      expect(store.delete(bot.id, teamId)).toBe(true);
      expect(store.get(bot.id, teamId)).toBeUndefined();
      expect(store.list(teamId)).toHaveLength(0);
    });

    it('returns false for wrong teamId', () => {
      const bot = store.create(baseInput);
      expect(store.delete(bot.id, 'team-other')).toBe(false);
    });

    it('returns false for nonexistent id', () => {
      expect(store.delete('nonexistent', teamId)).toBe(false);
    });

    it('returns false for already-deleted bot', () => {
      const bot = store.create(baseInput);
      store.delete(bot.id, teamId);
      expect(store.delete(bot.id, teamId)).toBe(false);
    });
  });
});
