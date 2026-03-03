import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from './schema.js';
import { SqliteAgentStore } from './agent-store.js';

describe('SqliteAgentStore', () => {
  let db: Database.Database;
  let store: SqliteAgentStore;

  const teamId = 'team-1';

  const baseInput = {
    teamId,
    slug: 'support-agent',
    name: 'Support Agent',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    store = new SqliteAgentStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('returns an AgentRecord with generated id and timestamps', () => {
      const agent = store.create(baseInput);

      expect(agent.id).toMatch(/^[0-9a-f]{8}-/);
      expect(agent.teamId).toBe(teamId);
      expect(agent.slug).toBe('support-agent');
      expect(agent.name).toBe('Support Agent');
      expect(agent.createdAt).toBeTruthy();
      expect(agent.updatedAt).toBe(agent.createdAt);
    });

    it('defaults to sensible values', () => {
      const agent = store.create(baseInput);

      expect(agent.description).toBe('');
      expect(agent.orchestrationStrategy).toBe('single');
      expect(agent.orchestratorModel).toBeNull();
      expect(agent.orchestratorPrompt).toBeNull();
      expect(agent.botId).toBeNull();
      expect(agent.fallbackBotId).toBeNull();
      expect(agent.appearance).toEqual({});
      expect(agent.endUserAuth).toEqual({});
      expect(agent.rateLimits).toEqual({});
      expect(agent.features).toEqual({});
      expect(agent.enabled).toBe(true);
    });

    it('persists all optional fields', () => {
      const agent = store.create({
        ...baseInput,
        description: 'Customer support',
        orchestrationStrategy: 'orchestrate',
        orchestratorModel: 'claude-sonnet-4-6',
        orchestratorPrompt: 'You orchestrate bots.',
        botId: 'bot-1',
        fallbackBotId: 'bot-2',
        appearance: { displayName: 'Support', welcomeMessage: 'Hi!' },
        endUserAuth: { mode: 'anonymous' as const },
        rateLimits: { messagesPerMinute: 10 },
        features: { artifacts: true },
        enabled: false,
      });

      expect(agent.orchestrationStrategy).toBe('orchestrate');
      expect(agent.orchestratorModel).toBe('claude-sonnet-4-6');
      expect(agent.botId).toBe('bot-1');
      expect(agent.fallbackBotId).toBe('bot-2');
      expect(agent.appearance.displayName).toBe('Support');
      expect(agent.endUserAuth.mode).toBe('anonymous');
      expect(agent.rateLimits.messagesPerMinute).toBe(10);
      expect(agent.features.artifacts).toBe(true);
      expect(agent.enabled).toBe(false);

      const fetched = store.get(agent.id, teamId);
      expect(fetched?.orchestrationStrategy).toBe('orchestrate');
    });

    it('enforces UNIQUE(team_id, slug)', () => {
      store.create(baseInput);
      expect(() => store.create(baseInput)).toThrow();
    });

    it('allows same slug for different teams', () => {
      store.create(baseInput);
      const a2 = store.create({ ...baseInput, teamId: 'team-2' });
      expect(a2.teamId).toBe('team-2');
    });
  });

  describe('get()', () => {
    it('returns agent by id and teamId', () => {
      const agent = store.create(baseInput);
      const fetched = store.get(agent.id, teamId);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(agent.id);
    });

    it('returns undefined for wrong teamId', () => {
      const agent = store.create(baseInput);
      expect(store.get(agent.id, 'team-other')).toBeUndefined();
    });

    it('returns undefined for nonexistent id', () => {
      expect(store.get('nonexistent', teamId)).toBeUndefined();
    });
  });

  describe('getBySlug()', () => {
    it('returns agent by slug and teamId', () => {
      const agent = store.create(baseInput);
      const fetched = store.getBySlug('support-agent', teamId);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(agent.id);
      expect(fetched!.slug).toBe('support-agent');
    });

    it('returns undefined for wrong teamId', () => {
      store.create(baseInput);
      expect(store.getBySlug('support-agent', 'team-other')).toBeUndefined();
    });

    it('returns undefined for nonexistent slug', () => {
      expect(store.getBySlug('nonexistent', teamId)).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('returns agents sorted by name', () => {
      store.create({ ...baseInput, slug: 'z-agent', name: 'Zebra' });
      store.create({ ...baseInput, slug: 'a-agent', name: 'Alpha' });

      const agents = store.list(teamId);
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('Alpha');
      expect(agents[1].name).toBe('Zebra');
    });

    it('isolates by team', () => {
      store.create(baseInput);
      store.create({ ...baseInput, teamId: 'team-2', slug: 'other' });

      expect(store.list(teamId)).toHaveLength(1);
    });

    it('returns empty array when no agents exist', () => {
      expect(store.list(teamId)).toEqual([]);
    });
  });

  describe('update()', () => {
    it('updates slug and name', () => {
      const agent = store.create(baseInput);
      const updated = store.update(agent.id, teamId, {
        slug: 'new-slug',
        name: 'New Name',
      });

      expect(updated!.slug).toBe('new-slug');
      expect(updated!.name).toBe('New Name');
    });

    it('updates orchestration config', () => {
      const agent = store.create(baseInput);
      const updated = store.update(agent.id, teamId, {
        orchestrationStrategy: 'orchestrate',
        orchestratorModel: 'gpt-4',
        orchestratorPrompt: 'Orchestrate!',
      });

      expect(updated!.orchestrationStrategy).toBe('orchestrate');
      expect(updated!.orchestratorModel).toBe('gpt-4');
    });

    it('sets nullable fields to null', () => {
      const agent = store.create({
        ...baseInput,
        orchestratorModel: 'gpt-4',
        botId: 'bot-1',
      });
      const updated = store.update(agent.id, teamId, {
        orchestratorModel: null,
        botId: null,
      });

      expect(updated!.orchestratorModel).toBeNull();
      expect(updated!.botId).toBeNull();
    });

    it('updates appearance and auth config', () => {
      const agent = store.create(baseInput);
      const updated = store.update(agent.id, teamId, {
        appearance: { displayName: 'Bot', avatarUrl: 'https://example.com/av.png' },
        endUserAuth: { mode: 'jwt', jwtSecret: 'secret' },
      });

      expect(updated!.appearance.displayName).toBe('Bot');
      expect(updated!.endUserAuth.mode).toBe('jwt');
    });

    it('updates enabled flag', () => {
      const agent = store.create(baseInput);
      const updated = store.update(agent.id, teamId, { enabled: false });

      expect(updated!.enabled).toBe(false);
    });

    it('returns undefined for wrong teamId', () => {
      const agent = store.create(baseInput);
      expect(store.update(agent.id, 'team-other', { name: 'Hack' })).toBeUndefined();
    });

    it('sets updated_at to a newer timestamp', () => {
      const agent = store.create(baseInput);
      const updated = store.update(agent.id, teamId, { name: 'Changed' });

      expect(updated!.updatedAt >= agent.updatedAt).toBe(true);
    });
  });

  describe('delete()', () => {
    it('removes agent and returns true', () => {
      const agent = store.create(baseInput);
      expect(store.delete(agent.id, teamId)).toBe(true);
      expect(store.get(agent.id, teamId)).toBeUndefined();
    });

    it('returns false for wrong teamId', () => {
      const agent = store.create(baseInput);
      expect(store.delete(agent.id, 'team-other')).toBe(false);
    });

    it('returns false for nonexistent id', () => {
      expect(store.delete('nonexistent', teamId)).toBe(false);
    });
  });
});
