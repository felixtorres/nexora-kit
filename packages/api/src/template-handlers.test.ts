import { describe, it, expect, vi } from 'vitest';
import {
  createTemplateCreateHandler,
  createTemplateListHandler,
  createTemplateGetHandler,
  createTemplateUpdateHandler,
  createTemplateDeleteHandler,
} from './template-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { TemplateHandlerDeps } from './template-handlers.js';
import type { IConversationTemplateStore, ConversationTemplateRecord } from '@nexora-kit/storage';

function makeAuth(role: 'admin' | 'user' = 'user'): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role };
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

function makeTemplate(overrides: Partial<ConversationTemplateRecord> = {}): ConversationTemplateRecord {
  return {
    id: 'tpl-1',
    teamId: 'team-1',
    name: 'test-template',
    description: '',
    systemPrompt: 'You are helpful.',
    pluginNamespaces: [],
    model: null,
    temperature: null,
    maxTurns: null,
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeMockStore(): IConversationTemplateStore {
  return {
    create: vi.fn().mockResolvedValue(makeTemplate()),
    get: vi.fn().mockResolvedValue(makeTemplate()),
    list: vi.fn().mockResolvedValue([makeTemplate()]),
    update: vi.fn().mockResolvedValue(makeTemplate()),
    delete: vi.fn().mockResolvedValue(true),
  };
}

describe('createTemplateCreateHandler', () => {
  it('creates template and returns 201', async () => {
    const store = makeMockStore();
    const handler = createTemplateCreateHandler({ templateStore: store });

    const res = await handler(makeReq({
      auth: makeAuth('admin'),
      body: { name: 'my-template', systemPrompt: 'Be helpful.' },
    }));

    expect(res.status).toBe(201);
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      name: 'my-template',
    }));
  });

  it('rejects non-admin users', async () => {
    const handler = createTemplateCreateHandler({ templateStore: makeMockStore() });
    await expect(handler(makeReq({ body: { name: 'x' } }))).rejects.toThrow('Admin access required');
  });

  it('rejects invalid body', async () => {
    const handler = createTemplateCreateHandler({ templateStore: makeMockStore() });
    await expect(handler(makeReq({
      auth: makeAuth('admin'),
      body: { name: '' },
    }))).rejects.toThrow('Invalid request');
  });
});

describe('createTemplateListHandler', () => {
  it('lists templates for authenticated user', async () => {
    const store = makeMockStore();
    const handler = createTemplateListHandler({ templateStore: store });

    const res = await handler(makeReq());
    expect(res.status).toBe(200);
    expect((res.body as any).templates).toHaveLength(1);
    expect(store.list).toHaveBeenCalledWith('team-1');
  });
});

describe('createTemplateGetHandler', () => {
  it('returns template by id', async () => {
    const store = makeMockStore();
    const handler = createTemplateGetHandler({ templateStore: store });

    const res = await handler(makeReq({ params: { id: 'tpl-1' } }));
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing template', async () => {
    const store = makeMockStore();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createTemplateGetHandler({ templateStore: store });

    await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Template not found');
  });
});

describe('createTemplateUpdateHandler', () => {
  it('updates template for admin', async () => {
    const store = makeMockStore();
    const handler = createTemplateUpdateHandler({ templateStore: store });

    const res = await handler(makeReq({
      auth: makeAuth('admin'),
      params: { id: 'tpl-1' },
      body: { name: 'updated' },
    }));

    expect(res.status).toBe(200);
    expect(store.update).toHaveBeenCalledWith('tpl-1', 'team-1', expect.objectContaining({ name: 'updated' }));
  });

  it('rejects non-admin', async () => {
    const handler = createTemplateUpdateHandler({ templateStore: makeMockStore() });
    await expect(handler(makeReq({ params: { id: 'tpl-1' }, body: {} }))).rejects.toThrow('Admin access required');
  });
});

describe('createTemplateDeleteHandler', () => {
  it('deletes template for admin', async () => {
    const store = makeMockStore();
    const handler = createTemplateDeleteHandler({ templateStore: store });

    const res = await handler(makeReq({
      auth: makeAuth('admin'),
      params: { id: 'tpl-1' },
    }));

    expect(res.status).toBe(204);
    expect(store.delete).toHaveBeenCalledWith('tpl-1', 'team-1');
  });

  it('returns 404 for missing template', async () => {
    const store = makeMockStore();
    (store.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const handler = createTemplateDeleteHandler({ templateStore: store });

    await expect(handler(makeReq({
      auth: makeAuth('admin'),
      params: { id: 'nope' },
    }))).rejects.toThrow('Template not found');
  });
});
