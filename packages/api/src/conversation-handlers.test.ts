import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createConversationCreateHandler,
  createConversationListHandler,
  createConversationGetHandler,
  createConversationUpdateHandler,
  createConversationDeleteHandler,
  createSendMessageHandler,
} from './handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { HandlerDeps } from './handlers.js';
import type {
  IConversationStore,
  ConversationRecord,
  CreateConversationInput,
  ConversationPatch,
  ListConversationsOptions,
  PaginatedResult,
} from '@nexora-kit/storage';

// --- Helpers ---

function makeAuth(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role: 'user', ...overrides };
}

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/test',
    headers: {},
    params: {},
    query: {},
    auth: makeAuth(),
    ...overrides,
  };
}

function makeMockAgentLoop(events: Array<{ type: string; [key: string]: unknown }> = []) {
  return {
    run: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
    abort: vi.fn(),
    toolDispatcher: {} as any,
  };
}

// --- In-memory IConversationStore ---

class InMemoryConversationStore implements IConversationStore {
  private conversations = new Map<string, ConversationRecord>();

  create(input: CreateConversationInput): ConversationRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id,
      teamId: input.teamId,
      userId: input.userId,
      title: input.title ?? null,
      systemPrompt: input.systemPrompt ?? null,
      templateId: input.templateId ?? null,
      workspaceId: input.workspaceId ?? null,
      model: input.model ?? null,
      agentId: input.agentId ?? null,
      pluginNamespaces: input.pluginNamespaces ?? [],
      messageCount: 0,
      lastMessageAt: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.conversations.set(id, record);
    return record;
  }

  get(id: string, userId: string): ConversationRecord | undefined {
    const record = this.conversations.get(id);
    if (!record || record.userId !== userId || record.deletedAt) return undefined;
    return record;
  }

  list(userId: string, opts?: ListConversationsOptions): PaginatedResult<ConversationRecord> {
    const items = [...this.conversations.values()]
      .filter((c) => c.userId === userId && !c.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const limit = opts?.limit ?? 20;
    return { items: items.slice(0, limit), nextCursor: items.length > limit ? 'next' : null };
  }

  update(id: string, userId: string, patch: ConversationPatch): ConversationRecord | undefined {
    const record = this.get(id, userId);
    if (!record) return undefined;
    if (patch.title !== undefined) record.title = patch.title;
    if (patch.metadata !== undefined) record.metadata = patch.metadata;
    record.updatedAt = new Date().toISOString();
    return { ...record };
  }

  softDelete(id: string, userId: string): boolean {
    const record = this.get(id, userId);
    if (!record) return false;
    record.deletedAt = new Date().toISOString();
    return true;
  }

  updateMessageStats(id: string, count: number, lastMessageAt: string): void {
    const record = this.conversations.get(id);
    if (record) {
      record.messageCount = count;
      record.lastMessageAt = lastMessageAt;
    }
  }
}

// --- Mock MessageStore ---

function makeMockMessageStore(messages: any[] = []) {
  return {
    get: vi.fn().mockResolvedValue(messages),
    append: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    truncateFrom: vi.fn().mockResolvedValue(undefined),
  };
}

// --- Deps factory ---

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    agentLoop: makeMockAgentLoop() as any,
    conversationStore: new InMemoryConversationStore(),
    messageStore: makeMockMessageStore() as any,
    ...overrides,
  };
}

// --- Tests ---

describe('createConversationCreateHandler', () => {
  it('creates conversation with title', async () => {
    const deps = makeDeps();
    const handler = createConversationCreateHandler(deps);

    const res = await handler(makeReq({
      method: 'POST',
      body: { title: 'My Conversation' },
    }));

    expect(res.status).toBe(201);
    const body = res.body as ConversationRecord;
    expect(body.title).toBe('My Conversation');
    expect(body.userId).toBe('user-1');
    expect(body.teamId).toBe('team-1');
    expect(body.id).toBeDefined();
  });

  it('creates conversation with no body (defaults)', async () => {
    const deps = makeDeps();
    const handler = createConversationCreateHandler(deps);

    const res = await handler(makeReq({ method: 'POST' }));

    expect(res.status).toBe(201);
    const body = res.body as ConversationRecord;
    expect(body.title).toBeNull();
    expect(body.userId).toBe('user-1');
    expect(body.messageCount).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createConversationCreateHandler(deps);

    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createConversationListHandler', () => {
  it('lists conversations', async () => {
    const store = new InMemoryConversationStore();
    store.create({ teamId: 'team-1', userId: 'user-1', title: 'Conv A' });
    store.create({ teamId: 'team-1', userId: 'user-1', title: 'Conv B' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationListHandler(deps);

    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    const body = res.body as PaginatedResult<ConversationRecord>;
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createConversationListHandler(deps);

    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createConversationGetHandler', () => {
  it('gets existing conversation', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-1', title: 'Test' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationGetHandler(deps);

    const res = await handler(makeReq({ params: { id: created.id } }));

    expect(res.status).toBe(200);
    const body = res.body as ConversationRecord;
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('Test');
  });

  it('returns 404 for nonexistent or wrong user', async () => {
    const store = new InMemoryConversationStore();
    store.create({ teamId: 'team-1', userId: 'user-2', title: 'Other' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationGetHandler(deps);

    // Wrong user — user-1 cannot see user-2's conversation
    await expect(handler(makeReq({ params: { id: 'nonexistent-id' } }))).rejects.toThrow('Conversation not found');
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createConversationGetHandler(deps);

    await expect(handler(makeReq({ auth: undefined, params: { id: 'any' } }))).rejects.toThrow('Authentication required');
  });
});

describe('createConversationUpdateHandler', () => {
  it('updates title', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-1', title: 'Old' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationUpdateHandler(deps);

    const res = await handler(makeReq({
      method: 'PATCH',
      params: { id: created.id },
      body: { title: 'New Title' },
    }));

    expect(res.status).toBe(200);
    const body = res.body as ConversationRecord;
    expect(body.title).toBe('New Title');
  });

  it('returns 404 for wrong user', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-2', title: 'Other' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationUpdateHandler(deps);

    await expect(handler(makeReq({
      method: 'PATCH',
      params: { id: created.id },
      body: { title: 'Hacked' },
    }))).rejects.toThrow('Conversation not found');
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createConversationUpdateHandler(deps);

    await expect(handler(makeReq({
      auth: undefined,
      params: { id: 'any' },
      body: { title: 'X' },
    }))).rejects.toThrow('Authentication required');
  });
});

describe('createConversationDeleteHandler', () => {
  it('deletes conversation and returns 204 with null body', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-1', title: 'Doomed' });

    const deps = makeDeps({ conversationStore: store });
    const handler = createConversationDeleteHandler(deps);

    const res = await handler(makeReq({
      method: 'DELETE',
      params: { id: created.id },
    }));

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();

    // Verify the conversation is no longer retrievable
    expect(store.get(created.id, 'user-1')).toBeUndefined();
  });

  it('returns 404 for nonexistent conversation', async () => {
    const deps = makeDeps();
    const handler = createConversationDeleteHandler(deps);

    await expect(handler(makeReq({
      method: 'DELETE',
      params: { id: 'nonexistent-id' },
    }))).rejects.toThrow('Conversation not found');
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createConversationDeleteHandler(deps);

    await expect(handler(makeReq({
      auth: undefined,
      params: { id: 'any' },
    }))).rejects.toThrow('Authentication required');
  });
});

describe('createSendMessageHandler', () => {
  it('sends message to existing conversation', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-1', title: 'Chat' });

    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'back!' },
      { type: 'done' },
    ]);

    const deps = makeDeps({
      agentLoop: agentLoop as any,
      conversationStore: store,
      messageStore: makeMockMessageStore([{ role: 'user' }, { role: 'assistant' }]) as any,
    });
    const handler = createSendMessageHandler(deps);

    const res = await handler(makeReq({
      method: 'POST',
      params: { id: created.id },
      body: { input: 'Hi there' },
    }));

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.conversationId).toBe(created.id);
    expect(body.message).toBe('Hello back!');
    expect(body.events).toHaveLength(3);

    expect(agentLoop.run).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: created.id,
      input: { type: 'text', text: 'Hi there' },
      teamId: 'team-1',
      userId: 'user-1',
    }), undefined);
  });

  it('returns 404 for nonexistent conversation', async () => {
    const store = new InMemoryConversationStore();
    const agentLoop = makeMockAgentLoop([]);

    const deps = makeDeps({ agentLoop: agentLoop as any, conversationStore: store });
    const handler = createSendMessageHandler(deps);

    await expect(handler(makeReq({
      method: 'POST',
      params: { id: 'nonexistent-id' },
      body: { input: 'Hello' },
    }))).rejects.toThrow('Conversation not found');
  });

  it('auto-titles from first message if conversation has no title', async () => {
    const store = new InMemoryConversationStore();
    const created = store.create({ teamId: 'team-1', userId: 'user-1' }); // no title

    expect(created.title).toBeNull();

    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Sure!' },
      { type: 'done' },
    ]);

    const deps = makeDeps({
      agentLoop: agentLoop as any,
      conversationStore: store,
      messageStore: makeMockMessageStore([]) as any,
    });
    const handler = createSendMessageHandler(deps);

    await handler(makeReq({
      method: 'POST',
      params: { id: created.id },
      body: { input: 'What is the meaning of life?' },
    }));

    // Verify the conversation was auto-titled
    const updated = store.get(created.id, 'user-1');
    expect(updated).toBeDefined();
    expect(updated!.title).toBe('What is the meaning of life?');
  });

  it('rejects unauthenticated requests', async () => {
    const deps = makeDeps();
    const handler = createSendMessageHandler(deps);

    await expect(handler(makeReq({
      auth: undefined,
      params: { id: 'any' },
      body: { input: 'Hello' },
    }))).rejects.toThrow('Authentication required');
  });
});
