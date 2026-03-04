import { describe, it, expect, vi, afterEach } from 'vitest';
import { Gateway } from './gateway.js';
import { ApiKeyAuth } from './auth.js';

function makeMockAgentLoop(events: any[] = [{ type: 'text', content: 'Hi' }, { type: 'done' }]) {
  return {
    run: vi.fn().mockImplementation(async function* () {
      for (const e of events) yield e;
    }),
    abort: vi.fn(),
    toolDispatcher: { listTools: () => [] } as any,
  } as any;
}

function makeMockPlugins(plugins: any[] = []) {
  return {
    listPlugins: vi.fn().mockReturnValue(plugins),
    getPlugin: vi.fn().mockImplementation((ns: string) => plugins.find((p: any) => p.manifest.namespace === ns)),
  } as any;
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(url, options);
  const body = res.status !== 204 ? await res.json() : null;
  return { status: res.status, body, headers: res.headers };
}

describe('Gateway', () => {
  let gateway: Gateway;

  afterEach(async () => {
    await gateway?.stop();
  });

  it('starts and serves health endpoint without auth', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key-1': { userId: 'u1', teamId: 't1', role: 'user' } }),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/health`);
    expect(status).toBe(200);
    expect(body.status).toBe('healthy');
  });

  it('rejects unauthenticated chat requests', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key-1': { userId: 'u1', teamId: 't1', role: 'user' } }),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Hello' }),
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('processes authenticated chat requests', async () => {
    const agentLoop = makeMockAgentLoop([
      { type: 'text', content: 'Hello back!' },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'done' },
    ]);

    gateway = new Gateway({
      port: 0,
      agentLoop,
      auth: new ApiKeyAuth({ 'my-key': { userId: 'u1', teamId: 't1', role: 'user' } }),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-key',
      },
      body: JSON.stringify({ input: 'Hello' }),
    });

    expect(status).toBe(200);
    expect(body.message).toBe('Hello back!');
    expect(body.conversationId).toBeDefined();
  });

  it('returns 404 for unknown routes', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/unknown`);
    expect(status).toBe(404);
  });

  it('lists plugins', async () => {
    const plugins = makeMockPlugins([
      {
        manifest: { name: 'Test', namespace: 'test', version: '1.0.0', description: 'A test', permissions: [], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'enabled',
        tools: [{ name: 'tool1', description: 'Tool' }],
      },
    ]);

    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
      plugins,
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/plugins`, {
      headers: { Authorization: 'Bearer key' },
    });

    expect(status).toBe(200);
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].namespace).toBe('test');
  });

  it('returns plugin details', async () => {
    const plugins = makeMockPlugins([
      {
        manifest: { name: 'Test', namespace: 'test', version: '1.0.0', description: 'A test', permissions: ['llm:invoke'], dependencies: [], sandbox: { tier: 'basic' } },
        state: 'enabled',
        tools: [{ name: 'tool1', description: 'Tool' }],
      },
    ]);

    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
      plugins,
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/plugins/test`, {
      headers: { Authorization: 'Bearer key' },
    });

    expect(status).toBe(200);
    expect(body.namespace).toBe('test');
    expect(body.tools).toHaveLength(1);
  });

  it('enforces rate limiting', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
      rateLimit: { windowMs: 60_000, maxRequests: 2 },
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const headers = { Authorization: 'Bearer key' };
    await fetchJson(`http://${addr.host}:${addr.port}/v1/plugins`, { headers });
    await fetchJson(`http://${addr.host}:${addr.port}/v1/plugins`, { headers });
    const { status, body, headers: resHeaders } = await fetchJson(`http://${addr.host}:${addr.port}/v1/plugins`, { headers });

    expect(status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(resHeaders.get('retry-after')).toBeDefined();
  });

  it('handles CORS preflight with wildcard when no allowedOrigins', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat`, {
      method: 'OPTIONS',
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('reflects matching origin when allowedOrigins is set', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
      allowedOrigins: ['https://app.example.com', 'https://admin.example.com'],
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const res = await fetch(`http://${addr.host}:${addr.port}/v1/health`, {
      headers: { Origin: 'https://app.example.com' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('returns first origin for non-matching origin', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
      allowedOrigins: ['https://app.example.com'],
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const res = await fetch(`http://${addr.host}:${addr.port}/v1/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('returns address after start', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
    });
    await gateway.start();
    const addr = gateway.getAddress();
    expect(addr).not.toBeNull();
    expect(addr!.port).toBeGreaterThan(0);
  });

  it('custom apiPrefix', async () => {
    gateway = new Gateway({
      port: 0,
      apiPrefix: '/api/v2',
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status } = await fetchJson(`http://${addr.host}:${addr.port}/api/v2/health`);
    expect(status).toBe(200);

    // Old prefix should 404
    const { status: oldStatus } = await fetchJson(`http://${addr.host}:${addr.port}/v1/health`);
    expect(oldStatus).toBe(404);
  });

  it('includes X-Request-Id correlation header', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const res = await fetch(`http://${addr.host}:${addr.port}/v1/health`);
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(/^req-/);
  });

  it('echoes client-provided X-Request-Id', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({}),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const res = await fetch(`http://${addr.host}:${addr.port}/v1/health`, {
      headers: { 'X-Request-Id': 'my-trace-id-123' },
    });

    expect(res.headers.get('x-request-id')).toBe('my-trace-id-123');
  });

  it('metrics requires auth by default (publicMetrics unset)', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    // Without auth → 401
    const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/metrics`);
    expect(status).toBe(401);

    // With auth → 200
    const { status: authStatus } = await fetchJson(`http://${addr.host}:${addr.port}/v1/metrics`, {
      headers: { Authorization: 'Bearer key' },
    });
    expect(authStatus).toBe(200);
  });

  it('metrics is public when publicMetrics is true', async () => {
    gateway = new Gateway({
      port: 0,
      agentLoop: makeMockAgentLoop(),
      auth: new ApiKeyAuth({ 'key': { userId: 'u1', teamId: 't1', role: 'user' } }),
      publicMetrics: true,
    });
    await gateway.start();
    const addr = gateway.getAddress()!;

    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/metrics`);
    expect(status).toBe(200);
    expect(body.uptime_seconds).toBeDefined();
  });
});
