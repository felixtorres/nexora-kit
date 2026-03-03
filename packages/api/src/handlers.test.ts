import { describe, it, expect, vi } from 'vitest';
import { createChatHandler, createPluginsListHandler, createPluginDetailHandler, createHealthHandler } from './handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { HandlerDeps } from './handlers.js';

function makeAuth(role: 'admin' | 'user' = 'user'): AuthIdentity {
  return { userId: 'user1', teamId: 'team1', role };
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

function makeMockAgentLoop(events: Array<{ type: string; [key: string]: unknown }>) {
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

function makeMockPlugins(plugins: any[] = []) {
  return {
    listPlugins: vi.fn().mockReturnValue(plugins),
    getPlugin: vi.fn().mockImplementation((ns: string) => plugins.find((p) => p.manifest.namespace === ns)),
  } as any;
}

describe('createChatHandler', () => {
  it('processes chat request and returns response', async () => {
    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world!' },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'done' },
    ]);

    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);
    const res = await handler(makeReq({
      method: 'POST',
      body: { input: 'Hi there', conversationId: 'conv-1' },
    }));

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.conversationId).toBe('conv-1');
    expect(body.message).toBe('Hello world!');
    expect(body.events).toHaveLength(4);

    expect(agentLoop.run).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      input: { type: 'text', text: 'Hi there' },
      teamId: 'team1',
      userId: 'user1',
    }), undefined);
  });

  it('generates conversationId when not provided', async () => {
    const agentLoop = makeMockAgentLoop([{ type: 'done' }]);
    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);

    const res = await handler(makeReq({
      method: 'POST',
      body: { input: 'Hi' },
    }));

    const body = res.body as any;
    expect(body.conversationId).toMatch(/^conv-/);
  });

  it('rejects unauthenticated requests', async () => {
    const agentLoop = makeMockAgentLoop([]);
    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);

    await expect(handler(makeReq({ auth: undefined, body: { input: 'Hi' } }))).rejects.toThrow('Authentication required');
  });

  it('rejects invalid body', async () => {
    const agentLoop = makeMockAgentLoop([]);
    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);

    await expect(handler(makeReq({ body: { input: '' } }))).rejects.toThrow('Invalid request');
  });

  it('rejects missing input', async () => {
    const agentLoop = makeMockAgentLoop([]);
    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);

    await expect(handler(makeReq({ body: {} }))).rejects.toThrow('Invalid request');
  });
});

describe('createPluginsListHandler', () => {
  it('lists plugins', async () => {
    const plugins = makeMockPlugins([
      {
        manifest: { name: 'Test', namespace: 'test', version: '1.0.0', description: 'A test plugin', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'enabled',
        tools: [{ name: 'tool1', description: 'A tool' }],
      },
    ]);

    const handler = createPluginsListHandler({ agentLoop: {} as any, plugins });
    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].namespace).toBe('test');
    expect(body.plugins[0].toolCount).toBe(1);
  });

  it('returns empty when no plugin manager', async () => {
    const handler = createPluginsListHandler({ agentLoop: {} as any });
    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    expect((res.body as any).plugins).toEqual([]);
  });

  it('rejects unauthenticated', async () => {
    const handler = createPluginsListHandler({ agentLoop: {} as any });
    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createPluginDetailHandler', () => {
  it('returns plugin details', async () => {
    const plugins = makeMockPlugins([
      {
        manifest: { name: 'Test', namespace: 'test', version: '1.0.0', description: 'Desc', permissions: ['llm:invoke'], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'enabled',
        tools: [{ name: 'tool1', description: 'Tool' }],
      },
    ]);

    const handler = createPluginDetailHandler({ agentLoop: {} as any, plugins });
    const res = await handler(makeReq({ params: { name: 'test' } }));

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.namespace).toBe('test');
    expect(body.permissions).toEqual(['llm:invoke']);
    expect(body.tools).toHaveLength(1);
  });

  it('returns 404 for unknown plugin', async () => {
    const plugins = makeMockPlugins([]);
    const handler = createPluginDetailHandler({ agentLoop: {} as any, plugins });

    await expect(handler(makeReq({ params: { name: 'nope' } }))).rejects.toThrow('Plugin not found');
  });
});

describe('createHealthHandler', () => {
  it('returns healthy status', async () => {
    const plugins = makeMockPlugins([
      { manifest: { namespace: 'a' }, state: 'enabled', tools: [] },
      { manifest: { namespace: 'b' }, state: 'enabled', tools: [] },
    ]);

    const handler = createHealthHandler({ agentLoop: {} as any, plugins });
    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.status).toBe('healthy');
    expect(body.plugins.total).toBe(2);
    expect(body.plugins.enabled).toBe(2);
  });

  it('returns degraded when plugins errored', async () => {
    const plugins = makeMockPlugins([
      { manifest: { namespace: 'a' }, state: 'enabled', tools: [] },
      { manifest: { namespace: 'b' }, state: 'errored', tools: [] },
    ]);

    const handler = createHealthHandler({ agentLoop: {} as any, plugins });
    const res = await handler(makeReq());

    expect((res.body as any).status).toBe('degraded');
    expect((res.body as any).plugins.errored).toBe(1);
  });

  it('works without plugin manager', async () => {
    const handler = createHealthHandler({ agentLoop: {} as any });
    const res = await handler(makeReq());

    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('healthy');
  });

  it('does not require authentication', async () => {
    const handler = createHealthHandler({ agentLoop: {} as any });
    const res = await handler(makeReq({ auth: undefined }));
    expect(res.status).toBe(200);
  });
});

describe('blocks in responses', () => {
  it('includes blocks in sendMessage response', async () => {
    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Here is your order' },
      { type: 'blocks', blocks: [{ type: 'card', title: 'Order #1' }] },
      { type: 'done' },
    ]);

    const { createSendMessageHandler } = await import('./handlers.js');
    const handler = createSendMessageHandler({ agentLoop } as unknown as HandlerDeps);
    const res = await handler(makeReq({
      method: 'POST',
      params: { id: 'conv-1' },
      body: { input: 'show order' },
    }));

    const body = res.body as any;
    expect(body.message).toBe('Here is your order');
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].type).toBe('card');
  });

  it('omits blocks field when no blocks events', async () => {
    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Just text' },
      { type: 'done' },
    ]);

    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);
    const res = await handler(makeReq({
      method: 'POST',
      body: { input: 'Hello' },
    }));

    const body = res.body as any;
    expect(body.message).toBe('Just text');
    expect(body.blocks).toBeUndefined();
  });

  it('includes blocks in legacy chat response', async () => {
    const agentLoop = makeMockAgentLoop([
      { type: 'blocks', blocks: [{ type: 'text', content: 'Block text' }] },
      { type: 'done' },
    ]);

    const handler = createChatHandler({ agentLoop } as unknown as HandlerDeps);
    const res = await handler(makeReq({
      method: 'POST',
      body: { input: 'Hi' },
    }));

    const body = res.body as any;
    expect(body.blocks).toHaveLength(1);
  });
});
