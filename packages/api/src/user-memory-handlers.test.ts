import { describe, it, expect, vi } from 'vitest';
import {
  createListMemoryHandler,
  createDeleteMemoryFactHandler,
  createDeleteAllMemoryHandler,
} from './user-memory-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { UserMemoryHandlerDeps } from './user-memory-handlers.js';
import type { IUserMemoryStore } from '@nexora-kit/storage';

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

function makeMockStore(): IUserMemoryStore {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    deleteAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe('createListMemoryHandler', () => {
  it('lists facts for authenticated user', async () => {
    const store = makeMockStore();
    (store.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: 'name', value: 'Alice', namespace: 'global', source: 'user', pluginNamespace: null, confidence: null, createdAt: '', updatedAt: '' },
    ]);

    const handler = createListMemoryHandler({ userMemoryStore: store });
    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    expect((res.body as any).facts).toHaveLength(1);
    expect(store.list).toHaveBeenCalledWith('user-1', { namespace: undefined });
  });

  it('passes namespace filter', async () => {
    const store = makeMockStore();
    const handler = createListMemoryHandler({ userMemoryStore: store });

    await handler(makeReq({ query: { namespace: '@faq' } }));
    expect(store.list).toHaveBeenCalledWith('user-1', { namespace: '@faq' });
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createListMemoryHandler({ userMemoryStore: makeMockStore() });
    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createDeleteMemoryFactHandler', () => {
  it('deletes a fact and returns 204', async () => {
    const store = makeMockStore();
    const handler = createDeleteMemoryFactHandler({ userMemoryStore: store });

    const res = await handler(makeReq({
      method: 'DELETE',
      params: { key: 'name' },
    }));

    expect(res.status).toBe(204);
    expect(store.delete).toHaveBeenCalledWith('user-1', 'name');
  });

  it('returns 404 for nonexistent fact', async () => {
    const store = makeMockStore();
    (store.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const handler = createDeleteMemoryFactHandler({ userMemoryStore: store });
    await expect(handler(makeReq({
      method: 'DELETE',
      params: { key: 'nope' },
    }))).rejects.toThrow('Fact not found');
  });
});

describe('createDeleteAllMemoryHandler', () => {
  it('deletes all facts with confirm=true', async () => {
    const store = makeMockStore();
    const handler = createDeleteAllMemoryHandler({ userMemoryStore: store });

    const res = await handler(makeReq({
      method: 'DELETE',
      query: { confirm: 'true' },
    }));

    expect(res.status).toBe(204);
    expect(store.deleteAll).toHaveBeenCalledWith('user-1');
  });

  it('rejects without confirm=true', async () => {
    const handler = createDeleteAllMemoryHandler({ userMemoryStore: makeMockStore() });
    await expect(handler(makeReq({
      method: 'DELETE',
    }))).rejects.toThrow('Must pass confirm=true');
  });
});
