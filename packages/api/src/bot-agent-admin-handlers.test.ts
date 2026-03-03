import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, SqliteBotStore, SqliteAgentStore, SqliteAgentBotBindingStore, SqliteEndUserStore } from '@nexora-kit/storage';
import {
  createBotCreateHandler,
  createBotListHandler,
  createBotGetHandler,
  createBotUpdateHandler,
  createBotDeleteHandler,
  createAgentCreateHandler,
  createAgentListHandler,
  createAgentGetHandler,
  createAgentUpdateHandler,
  createAgentDeleteHandler,
  createReplaceBindingsHandler,
  createEndUserListHandler,
  type BotAgentAdminDeps,
} from './bot-agent-admin-handlers.js';
import type { ApiRequest } from './types.js';

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    url: '/v1/admin/bots',
    headers: {},
    params: {},
    query: {},
    auth: { userId: 'admin-1', teamId: 'team-1', role: 'admin' },
    ...overrides,
  };
}

describe('Bot & Agent Admin Handlers', () => {
  let db: Database.Database;
  let deps: BotAgentAdminDeps;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    deps = {
      botStore: new SqliteBotStore(db),
      agentStore: new SqliteAgentStore(db),
      agentBotBindingStore: new SqliteAgentBotBindingStore(db),
      endUserStore: new SqliteEndUserStore(db),
    };
  });

  afterEach(() => {
    db.close();
  });

  // --- Bot CRUD ---

  describe('POST /admin/bots', () => {
    it('creates a bot and returns 201', async () => {
      const handler = createBotCreateHandler(deps);
      const res = await handler(makeReq({
        body: { name: 'Support', systemPrompt: 'Help users', model: 'claude-sonnet-4-6' },
      }));

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.name).toBe('Support');
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.id).toBeDefined();
    });

    it('rejects invalid body with 400', async () => {
      const handler = createBotCreateHandler(deps);
      await expect(handler(makeReq({ body: { name: '' } }))).rejects.toThrow();
    });

    it('rejects non-admin with 403', async () => {
      const handler = createBotCreateHandler(deps);
      await expect(handler(makeReq({
        auth: { userId: 'u1', teamId: 'team-1', role: 'user' },
        body: { name: 'Bot', systemPrompt: 'x', model: 'm' },
      }))).rejects.toThrow('Admin access required');
    });
  });

  describe('GET /admin/bots', () => {
    it('lists bots for team', async () => {
      deps.botStore.create({ teamId: 'team-1', name: 'Bot A', systemPrompt: 'a', model: 'm' });
      deps.botStore.create({ teamId: 'team-1', name: 'Bot B', systemPrompt: 'b', model: 'm' });

      const handler = createBotListHandler(deps);
      const res = await handler(makeReq());

      expect(res.status).toBe(200);
      expect((res.body as any).bots).toHaveLength(2);
    });
  });

  describe('GET /admin/bots/:id', () => {
    it('returns a bot by id', async () => {
      const bot = deps.botStore.create({ teamId: 'team-1', name: 'Bot', systemPrompt: 's', model: 'm' }) as any;
      const handler = createBotGetHandler(deps);
      const res = await handler(makeReq({ params: { id: bot.id } }));

      expect(res.status).toBe(200);
      expect((res.body as any).name).toBe('Bot');
    });

    it('returns 404 for nonexistent bot', async () => {
      const handler = createBotGetHandler(deps);
      await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Bot not found');
    });
  });

  describe('PATCH /admin/bots/:id', () => {
    it('updates a bot', async () => {
      const bot = deps.botStore.create({ teamId: 'team-1', name: 'Old', systemPrompt: 's', model: 'm' }) as any;
      const handler = createBotUpdateHandler(deps);
      const res = await handler(makeReq({
        params: { id: bot.id },
        body: { name: 'New', temperature: 0.5 },
      }));

      expect(res.status).toBe(200);
      expect((res.body as any).name).toBe('New');
      expect((res.body as any).temperature).toBe(0.5);
    });
  });

  describe('DELETE /admin/bots/:id', () => {
    it('deletes a bot and returns 204', async () => {
      const bot = deps.botStore.create({ teamId: 'team-1', name: 'Bot', systemPrompt: 's', model: 'm' }) as any;
      const handler = createBotDeleteHandler(deps);
      const res = await handler(makeReq({ params: { id: bot.id } }));

      expect(res.status).toBe(204);
    });

    it('returns 404 for nonexistent bot', async () => {
      const handler = createBotDeleteHandler(deps);
      await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Bot not found');
    });
  });

  // --- Agent CRUD ---

  describe('POST /admin/agents', () => {
    it('creates an agent and returns 201', async () => {
      const handler = createAgentCreateHandler(deps);
      const res = await handler(makeReq({
        body: { slug: 'support', name: 'Support Agent' },
      }));

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.slug).toBe('support');
      expect(body.orchestrationStrategy).toBe('single');
    });

    it('validates botId reference exists', async () => {
      const handler = createAgentCreateHandler(deps);
      await expect(handler(makeReq({
        body: { slug: 'test', name: 'Test', botId: 'nonexistent' },
      }))).rejects.toThrow('Referenced botId does not exist');
    });

    it('rejects invalid slug', async () => {
      const handler = createAgentCreateHandler(deps);
      await expect(handler(makeReq({
        body: { slug: 'INVALID SLUG!', name: 'Test' },
      }))).rejects.toThrow();
    });
  });

  describe('GET /admin/agents', () => {
    it('lists agents for team', async () => {
      deps.agentStore.create({ teamId: 'team-1', slug: 'a', name: 'A' });
      deps.agentStore.create({ teamId: 'team-1', slug: 'b', name: 'B' });

      const handler = createAgentListHandler(deps);
      const res = await handler(makeReq());

      expect(res.status).toBe(200);
      expect((res.body as any).agents).toHaveLength(2);
    });
  });

  describe('GET /admin/agents/:id', () => {
    it('returns agent with bindings', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'test', name: 'Test' }) as any;
      const bot = deps.botStore.create({ teamId: 'team-1', name: 'Bot', systemPrompt: 's', model: 'm' }) as any;
      deps.agentBotBindingStore.set({ agentId: agent.id, botId: bot.id, priority: 5 });

      const handler = createAgentGetHandler(deps);
      const res = await handler(makeReq({ params: { id: agent.id } }));

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.slug).toBe('test');
      expect(body.bindings).toHaveLength(1);
      expect(body.bindings[0].priority).toBe(5);
    });

    it('returns 404 for nonexistent agent', async () => {
      const handler = createAgentGetHandler(deps);
      await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Agent not found');
    });
  });

  describe('PATCH /admin/agents/:id', () => {
    it('updates an agent', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'old', name: 'Old' }) as any;
      const handler = createAgentUpdateHandler(deps);
      const res = await handler(makeReq({
        params: { id: agent.id },
        body: { name: 'New', enabled: false },
      }));

      expect(res.status).toBe(200);
      expect((res.body as any).name).toBe('New');
      expect((res.body as any).enabled).toBe(false);
    });
  });

  describe('DELETE /admin/agents/:id', () => {
    it('deletes agent and its bindings', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'del', name: 'Del' }) as any;
      const bot = deps.botStore.create({ teamId: 'team-1', name: 'Bot', systemPrompt: 's', model: 'm' }) as any;
      deps.agentBotBindingStore.set({ agentId: agent.id, botId: bot.id });

      const handler = createAgentDeleteHandler(deps);
      const res = await handler(makeReq({ params: { id: agent.id } }));

      expect(res.status).toBe(204);

      // Verify bindings were cleaned up
      const bindings = deps.agentBotBindingStore.list(agent.id);
      expect(bindings).toHaveLength(0);
    });
  });

  // --- Bindings ---

  describe('PUT /admin/agents/:id/bindings', () => {
    it('replaces all bindings', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'bind', name: 'Bind' }) as any;
      const bot1 = deps.botStore.create({ teamId: 'team-1', name: 'Bot1', systemPrompt: 's', model: 'm' }) as any;
      const bot2 = deps.botStore.create({ teamId: 'team-1', name: 'Bot2', systemPrompt: 's', model: 'm' }) as any;

      // Set initial binding
      deps.agentBotBindingStore.set({ agentId: agent.id, botId: bot1.id });

      // Replace with new set
      const handler = createReplaceBindingsHandler(deps);
      const res = await handler(makeReq({
        params: { id: agent.id },
        body: {
          bindings: [
            { botId: bot2.id, priority: 10, keywords: ['billing'] },
          ],
        },
      }));

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.bindings).toHaveLength(1);
      expect(body.bindings[0].botId).toBe(bot2.id);
      expect(body.bindings[0].keywords).toEqual(['billing']);

      // Old binding removed
      const bindings = deps.agentBotBindingStore.list(agent.id);
      expect(bindings).toHaveLength(1);
    });

    it('validates bot references', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'val', name: 'Val' }) as any;
      const handler = createReplaceBindingsHandler(deps);

      await expect(handler(makeReq({
        params: { id: agent.id },
        body: { bindings: [{ botId: 'nonexistent' }] },
      }))).rejects.toThrow('does not exist');
    });

    it('returns 404 for nonexistent agent', async () => {
      const handler = createReplaceBindingsHandler(deps);
      await expect(handler(makeReq({
        params: { id: 'nope' },
        body: { bindings: [] },
      }))).rejects.toThrow('Agent not found');
    });
  });

  // --- End Users ---

  describe('GET /admin/agents/:id/end-users', () => {
    it('lists end users for an agent', async () => {
      const agent = deps.agentStore.create({ teamId: 'team-1', slug: 'eu', name: 'EU' }) as any;
      deps.endUserStore.create({ agentId: agent.id, externalId: 'ext-1' });
      deps.endUserStore.create({ agentId: agent.id, externalId: 'ext-2' });

      const handler = createEndUserListHandler(deps);
      const res = await handler(makeReq({ params: { id: agent.id } }));

      expect(res.status).toBe(200);
      expect((res.body as any).users).toHaveLength(2);
    });

    it('returns 404 for nonexistent agent', async () => {
      const handler = createEndUserListHandler(deps);
      await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Agent not found');
    });
  });
});
