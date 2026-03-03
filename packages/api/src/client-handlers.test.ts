import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSchema,
  SqliteAgentStore,
  SqliteAgentBotBindingStore,
  SqliteEndUserStore,
  SqliteConversationStore,
  SqliteMessageStore,
} from '@nexora-kit/storage';
import type { ChatRequest, ChatEvent } from '@nexora-kit/core';
import {
  createAgentAppearanceHandler,
  createClientConversationCreateHandler,
  createClientConversationListHandler,
  createClientConversationGetHandler,
  createClientSendMessageHandler,
  type ClientHandlerDeps,
} from './client-handlers.js';
import type { ApiRequest } from './types.js';

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/test',
    headers: { 'x-end-user-id': 'end-user-1' },
    params: {},
    query: {},
    ...overrides,
  };
}

const mockAgentLoop = {
  async *run(request: ChatRequest): AsyncGenerator<ChatEvent> {
    yield { type: 'text', content: 'Hello from bot!' };
    yield { type: 'done' };
  },
} as any;

describe('Client Handlers', () => {
  let db: Database.Database;
  let deps: ClientHandlerDeps;
  let agentId: string;
  let teamId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);

    const agentStore = new SqliteAgentStore(db);
    const endUserStore = new SqliteEndUserStore(db);
    const conversationStore = new SqliteConversationStore(db);

    teamId = 'team-1';

    // Create a test agent with anonymous auth
    const agent = agentStore.create({
      teamId,
      slug: 'test-bot',
      name: 'Test Bot',
      endUserAuth: { mode: 'anonymous' },
      appearance: { displayName: 'TestBot', welcomeMessage: 'Hi there!' },
      features: { artifacts: true },
    });
    agentId = agent.id;

    deps = {
      agentStore,
      agentBotBindingStore: new SqliteAgentBotBindingStore(db),
      endUserStore,
      conversationStore,
      messageStore: new SqliteMessageStore(db),
      agentLoop: mockAgentLoop,
    };
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /agents/:slug (appearance)', () => {
    it('returns agent appearance info', async () => {
      const handler = createAgentAppearanceHandler(deps);
      const res = await handler(makeReq({
        params: { slug: 'test-bot', _agentId: agentId, _teamId: teamId },
      }));

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.slug).toBe('test-bot');
      expect(body.name).toBe('Test Bot');
      expect(body.appearance.displayName).toBe('TestBot');
      expect(body.features.artifacts).toBe(true);
    });

    it('returns 404 for nonexistent agent', async () => {
      const handler = createAgentAppearanceHandler(deps);
      await expect(handler(makeReq({
        params: { slug: 'nope', _agentId: 'bad', _teamId: teamId },
      }))).rejects.toThrow('Agent not found');
    });

    it('returns 404 when _agentId not injected', async () => {
      const handler = createAgentAppearanceHandler(deps);
      await expect(handler(makeReq({
        params: { slug: 'test-bot' },
      }))).rejects.toThrow('Agent not found');
    });
  });

  describe('POST /agents/:slug/conversations', () => {
    it('creates a conversation scoped to end user', async () => {
      const handler = createClientConversationCreateHandler(deps);
      const res = await handler(makeReq({
        method: 'POST',
        headers: { 'x-end-user-id': 'end-user-1' },
        params: { slug: 'test-bot', _agentId: agentId, _teamId: teamId },
        body: { title: 'My Chat' },
      }));

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.title).toBe('My Chat');
      expect(body.agentId).toBe(agentId);
    });

    it('creates end user record automatically', async () => {
      const handler = createClientConversationCreateHandler(deps);
      await handler(makeReq({
        method: 'POST',
        headers: { 'x-end-user-id': 'new-user' },
        params: { slug: 'test-bot', _agentId: agentId, _teamId: teamId },
        body: {},
      }));

      const users = deps.endUserStore.list(agentId) as any[];
      expect(users.length).toBeGreaterThan(0);
    });
  });

  describe('GET /agents/:slug/conversations', () => {
    it('lists conversations for end user only', async () => {
      // Create a conversation as end-user-1
      const conv = deps.conversationStore.create({
        teamId,
        userId: 'some-end-user-id',
        agentId,
        title: 'Chat 1',
      }) as any;

      // Create from another user
      deps.conversationStore.create({
        teamId,
        userId: 'other-user-id',
        agentId,
        title: 'Chat 2',
      });

      // Auth as end-user-1 — will create a new end user record, so the userId won't match existing ones
      // This test verifies the handler calls list with the resolved end user id
      const handler = createClientConversationListHandler(deps);
      const res = await handler(makeReq({
        headers: { 'x-end-user-id': 'end-user-list' },
        params: { slug: 'test-bot', _agentId: agentId, _teamId: teamId },
      }));

      expect(res.status).toBe(200);
      // New end user has no conversations
      expect((res.body as any).items).toHaveLength(0);
    });
  });

  describe('GET /agents/:slug/conversations/:id', () => {
    it('returns conversation owned by end user', async () => {
      // First, create a user via getOrCreate
      const endUser = deps.endUserStore.getOrCreate(agentId, 'eu-get') as any;

      // Create conversation as that user
      const conv = deps.conversationStore.create({
        teamId,
        userId: endUser.id,
        agentId,
      }) as any;

      const handler = createClientConversationGetHandler(deps);
      const res = await handler(makeReq({
        headers: { 'x-end-user-id': 'eu-get' },
        params: { slug: 'test-bot', id: conv.id, _agentId: agentId, _teamId: teamId },
      }));

      expect(res.status).toBe(200);
      expect((res.body as any).id).toBe(conv.id);
    });

    it('returns 404 for conversations owned by another user', async () => {
      const conv = deps.conversationStore.create({
        teamId,
        userId: 'other-user',
        agentId,
      }) as any;

      const handler = createClientConversationGetHandler(deps);
      await expect(handler(makeReq({
        headers: { 'x-end-user-id': 'eu-no-access' },
        params: { slug: 'test-bot', id: conv.id, _agentId: agentId, _teamId: teamId },
      }))).rejects.toThrow('Conversation not found');
    });
  });

  describe('POST /agents/:slug/conversations/:id/messages', () => {
    it('sends a message and returns response', async () => {
      // Create end user + conversation
      const endUser = deps.endUserStore.getOrCreate(agentId, 'eu-msg') as any;
      const conv = deps.conversationStore.create({
        teamId,
        userId: endUser.id,
        agentId,
      }) as any;

      const handler = createClientSendMessageHandler(deps);
      const res = await handler(makeReq({
        method: 'POST',
        headers: { 'x-end-user-id': 'eu-msg' },
        params: { slug: 'test-bot', id: conv.id, _agentId: agentId, _teamId: teamId },
        body: { input: 'Hello' },
      }));

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.message).toBe('Hello from bot!');
      expect(body.events).toHaveLength(2);
    });

    it('auto-titles conversation from first message', async () => {
      const endUser = deps.endUserStore.getOrCreate(agentId, 'eu-title') as any;
      const conv = deps.conversationStore.create({
        teamId,
        userId: endUser.id,
        agentId,
      }) as any;

      const handler = createClientSendMessageHandler(deps);
      await handler(makeReq({
        method: 'POST',
        headers: { 'x-end-user-id': 'eu-title' },
        params: { slug: 'test-bot', id: conv.id, _agentId: agentId, _teamId: teamId },
        body: { input: 'Hello' },
      }));

      const updated = deps.conversationStore.get(conv.id, endUser.id) as any;
      expect(updated.title).toBe('Hello from bot!');
    });

    it('rejects invalid input', async () => {
      const endUser = deps.endUserStore.getOrCreate(agentId, 'eu-bad') as any;
      const conv = deps.conversationStore.create({
        teamId,
        userId: endUser.id,
        agentId,
      }) as any;

      const handler = createClientSendMessageHandler(deps);
      await expect(handler(makeReq({
        method: 'POST',
        headers: { 'x-end-user-id': 'eu-bad' },
        params: { slug: 'test-bot', id: conv.id, _agentId: agentId, _teamId: teamId },
        body: {},
      }))).rejects.toThrow();
    });
  });
});
