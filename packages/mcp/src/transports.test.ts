import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioTransport, SseTransport, HttpTransport } from './transports.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

function createMockProcess(): ChildProcess & {
  _stdout: EventEmitter;
  _stderr: EventEmitter;
  _stdin: { write: ReturnType<typeof vi.fn> };
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { write: vi.fn() };
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.kill = vi.fn();
  proc.pid = 12345;
  proc._stdout = stdout;
  proc._stderr = stderr;
  proc._stdin = stdin;
  return proc;
}

describe('StdioTransport', () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(async () => {
    mockProc = createMockProcess();
    const { spawn } = await import('node:child_process');
    (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connects by spawning the command', async () => {
    const transport = new StdioTransport({ command: 'node', args: ['server.js'] });
    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    const { spawn } = await import('node:child_process');
    expect(spawn).toHaveBeenCalledWith('node', ['server.js'], expect.objectContaining({
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  });

  it('sends JSON-RPC requests via stdin', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const promise = transport.request('initialize', { protocolVersion: '2024-11-05' });

    expect(mockProc._stdin.write).toHaveBeenCalledOnce();
    const written = mockProc._stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace('\n', ''));
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('initialize');
    expect(parsed.params).toEqual({ protocolVersion: '2024-11-05' });

    // Simulate response
    mockProc._stdout.emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { capabilities: {} } }) + '\n',
    ));

    const result = await promise;
    expect(result).toEqual({ capabilities: {} });
  });

  it('handles JSON-RPC error responses', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const promise = transport.request('tools/call', { name: 'bad' });

    const written = mockProc._stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace('\n', ''));

    mockProc._stdout.emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32600, message: 'Invalid' } }) + '\n',
    ));

    await expect(promise).rejects.toThrow('JSON-RPC error -32600: Invalid');
  });

  it('times out on no response', async () => {
    const transport = new StdioTransport({ command: 'node', timeoutMs: 50 });
    await transport.connect();

    await expect(transport.request('test')).rejects.toThrow('Request timed out');
  });

  it('rejects pending requests on process exit', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const promise = transport.request('test');
    mockProc.emit('exit');

    await expect(promise).rejects.toThrow('Process exited');
    expect(transport.isConnected()).toBe(false);
  });

  it('handles multiple concurrent requests', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const p1 = transport.request('method1');
    const p2 = transport.request('method2');

    const calls = mockProc._stdin.write.mock.calls;
    const id1 = JSON.parse(calls[0][0]).id;
    const id2 = JSON.parse(calls[1][0]).id;

    expect(id1).not.toBe(id2);

    mockProc._stdout.emit('data', Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: id2, result: 'second' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: id1, result: 'first' }) + '\n',
    ));

    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
  });

  it('sends notifications without expecting response', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    transport.notify('notifications/initialized');

    const written = mockProc._stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace('\n', ''));
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('notifications/initialized');
    expect(parsed.id).toBeUndefined();
  });

  it('closes the process', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    await transport.close();
    expect(mockProc.kill).toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });

  it('captures stderr', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    mockProc._stderr.emit('data', Buffer.from('warning: something\n'));
    expect(transport.getStderr()).toContain('warning: something');
  });

  it('handles split JSON messages across chunks', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const promise = transport.request('test');
    const written = mockProc._stdin.write.mock.calls[0][0];
    const id = JSON.parse(written.replace('\n', '')).id;

    const full = JSON.stringify({ jsonrpc: '2.0', id, result: 'ok' }) + '\n';
    const mid = Math.floor(full.length / 2);

    mockProc._stdout.emit('data', Buffer.from(full.slice(0, mid)));
    mockProc._stdout.emit('data', Buffer.from(full.slice(mid)));

    expect(await promise).toBe('ok');
  });

  it('ignores non-JSON output lines', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await transport.connect();

    const promise = transport.request('test');
    const written = mockProc._stdin.write.mock.calls[0][0];
    const id = JSON.parse(written.replace('\n', '')).id;

    mockProc._stdout.emit('data', Buffer.from(
      'Server starting...\n' +
      JSON.stringify({ jsonrpc: '2.0', id, result: 'ok' }) + '\n',
    ));

    expect(await promise).toBe('ok');
  });

  it('passes env variables to spawned process', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = spawn as ReturnType<typeof vi.fn>;
    spawnMock.mockReturnValue(mockProc);

    const transport = new StdioTransport({
      command: 'node',
      env: { CUSTOM_VAR: 'value' },
    });
    await transport.connect();

    const lastCall = spawnMock.mock.lastCall!;
    expect(lastCall[2].env).toBeDefined();
    expect(lastCall[2].env.CUSTOM_VAR).toBe('value');
  });

  it('rejects requests when not connected', async () => {
    const transport = new StdioTransport({ command: 'node' });
    await expect(transport.request('test')).rejects.toThrow('Transport not connected');
  });
});

function createMockSseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(event + '\n\n'));
      }
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: stream,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  } as unknown as Response;
}

describe('SseTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('connects to SSE endpoint and waits for endpoint event', async () => {
    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({ url: 'http://localhost:3000/sse' });
    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/sse',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    );

    await transport.close();
  });

  it('throws on failed connection', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
    });

    const transport = new SseTransport({ url: 'http://localhost:3000/sse' });
    await expect(transport.connect()).rejects.toThrow('SSE connection failed: 500');
  });

  it('sends requests via POST and receives responses via SSE', async () => {
    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({ url: 'http://localhost:3000/sse', timeoutMs: 100 });
    await transport.connect();

    // Now mock the POST call to succeed
    mockFetch.mockResolvedValueOnce({ ok: true });

    const promise = transport.request('tools/list');

    // The request should have sent a POST
    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );

    // Let the request time out before closing to avoid unhandled rejection
    await promise.catch(() => {});
    await transport.close();
  });

  it('passes custom headers', async () => {
    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({
      url: 'http://localhost:3000/sse',
      headers: { Authorization: 'Bearer token' },
    });
    await transport.connect();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/sse',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );

    await transport.close();
  });

  it('rejects requests when not connected', async () => {
    const transport = new SseTransport({ url: 'http://localhost:3000/sse' });
    await expect(transport.request('test')).rejects.toThrow('Transport not connected');
  });

  it('closes cleanly', async () => {
    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({ url: 'http://localhost:3000/sse' });
    await transport.connect();

    await transport.close();
    expect(transport.isConnected()).toBe(false);
  });

  it('auto-creates OAuth2 client on 401 and retries connect', async () => {
    // First connect returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'www-authenticate': 'Bearer resource_metadata="https://auth.example.com/res"' }),
      body: null,
    } as unknown as Response);

    // OAuth2 authorize() will call fetchResourceMetadata + fetchAuthServerMetadata +
    // startCallbackServer + exchangeCode — mock the authorize method directly
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(true),
      getAccessToken: vi.fn().mockResolvedValue('fresh-token'),
      clearTokens: vi.fn(),
      authorize: vi.fn().mockResolvedValue(undefined),
    };

    const transport = new SseTransport({
      url: 'http://localhost:3000/sse',
      auth: mockAuth as any,
    });

    // Retry after auth succeeds
    mockFetch.mockResolvedValueOnce(createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]));

    await transport.connect();
    expect(transport.isConnected()).toBe(true);
    expect(mockAuth.authorize).toHaveBeenCalledWith('https://auth.example.com/res');

    // Verify Bearer token on retry
    const retryHeaders = mockFetch.mock.calls[1][1].headers;
    expect(retryHeaders['Authorization']).toBe('Bearer fresh-token');

    await transport.close();
  });

  it('includes Bearer token in POST requests when auth is set', async () => {
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(true),
      getAccessToken: vi.fn().mockResolvedValue('my-token'),
      clearTokens: vi.fn(),
      authorize: vi.fn(),
    };

    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({
      url: 'http://localhost:3000/sse',
      auth: mockAuth as any,
      timeoutMs: 100,
    });
    await transport.connect();

    await new Promise((r) => setTimeout(r, 10));

    mockFetch.mockResolvedValueOnce({ ok: true });
    const promise = transport.request('tools/list');

    await new Promise((r) => setTimeout(r, 10));
    const postHeaders = mockFetch.mock.calls[1][1].headers;
    expect(postHeaders['Authorization']).toBe('Bearer my-token');

    await promise.catch(() => {});
    await transport.close();
  });
});

describe('HttpTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(result: unknown, options?: { sessionId?: string; status?: number }): Response {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (options?.sessionId) {
      headers.set('mcp-session-id', options.sessionId);
    }
    return {
      ok: (options?.status ?? 200) < 400,
      status: options?.status ?? 200,
      statusText: options?.status === 500 ? 'Internal Server Error' : 'OK',
      headers,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
    } as unknown as Response;
  }

  it('connects without sending any request (no double-initialize)', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    // connect() no longer sends any fetch — server-handle does the initialize
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends requests with Accept header and parses JSON responses', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { tools: ['a', 'b'] } }),
    } as unknown as Response);

    const result = await transport.request('tools/list');
    expect(result).toEqual({ tools: ['a', 'b'] });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Accept']).toBe('application/json, text/event-stream');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('captures session-id from request() responses', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    // First request returns session-id
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'mcp-session-id': 'sess-123' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }),
    } as unknown as Response);

    await transport.request('initialize', { protocolVersion: '2025-03-26' });

    // Second request should include session-id
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    } as unknown as Response);

    await transport.request('tools/list');

    const headers = mockFetch.mock.calls[1][1].headers;
    expect(headers['mcp-session-id']).toBe('sess-123');
  });

  it('parses SSE response from POST', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    const sseBody = 'data: {"jsonrpc":"2.0","id":1,"result":{"tools":["x"]}}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream,
    } as unknown as Response);

    const result = await transport.request('tools/list');
    expect(result).toEqual({ tools: ['x'] });
  });

  it('throws on JSON-RPC error in response', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid' } }),
    } as unknown as Response);

    await expect(transport.request('bad/method')).rejects.toThrow('JSON-RPC error -32600: Invalid');
  });

  it('sends notifications fire-and-forget', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({ ok: true });

    transport.notify('notifications/initialized');

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('notifications/initialized');
    expect(body.id).toBeUndefined();
  });

  it('closes with session ID POST', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    // Do a request that sets session-id
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'mcp-session-id': 'sess-456' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    } as unknown as Response);
    await transport.request('initialize');

    mockFetch.mockResolvedValueOnce({ ok: true });
    await transport.close();

    expect(transport.isConnected()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const closeHeaders = mockFetch.mock.calls[1][1].headers;
    expect(closeHeaders['mcp-session-id']).toBe('sess-456');
  });

  it('closes without POST when no session ID', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    await transport.close();
    expect(transport.isConnected()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects requests when not connected', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await expect(transport.request('test')).rejects.toThrow('Transport not connected');
  });

  it('passes custom headers', async () => {
    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      headers: { 'X-Custom': 'value' },
    });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    } as unknown as Response);

    await transport.request('test');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Custom']).toBe('value');
  });

  it('retries on 401 when auth is provided', async () => {
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn().mockResolvedValue('new-token'),
      clearTokens: vi.fn(),
      authorize: vi.fn().mockImplementation(async () => {
        mockAuth.hasValidToken.mockReturnValue(true);
      }),
    };

    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      auth: mockAuth as any,
    });
    await transport.connect();

    // First request returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'www-authenticate': 'Bearer resource_metadata="https://auth.example.com/meta"' }),
    } as unknown as Response);

    // Retry after re-auth succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
    } as unknown as Response);

    const result = await transport.request('test');
    expect(result).toEqual({ ok: true });
    expect(mockAuth.clearTokens).toHaveBeenCalled();
    expect(mockAuth.authorize).toHaveBeenCalledWith('https://auth.example.com/meta');
  });

  it('attaches Bearer token when auth has valid token', async () => {
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(true),
      getAccessToken: vi.fn().mockResolvedValue('my-token'),
      clearTokens: vi.fn(),
      authorize: vi.fn(),
    };

    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      auth: mockAuth as any,
    });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    } as unknown as Response);

    await transport.request('test');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('works without auth (backward compatible)', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    } as unknown as Response);

    await transport.request('test');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('connect is passive with auth — no probe request sent', async () => {
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn(),
      clearTokens: vi.fn(),
      authorize: vi.fn(),
    };

    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      auth: mockAuth as any,
    });
    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    // No fetch during connect — 401 handling deferred to request()
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to SSE on 405 after auth retry still returns 405', async () => {
    const mockAuth = {
      hasValidToken: vi.fn().mockReturnValue(false),
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokens: vi.fn(),
      authorize: vi.fn().mockImplementation(async () => {
        mockAuth.hasValidToken.mockReturnValue(true);
      }),
    };

    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      auth: mockAuth as any,
      timeoutMs: 200,
    });
    await transport.connect();

    // First POST → 405
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 405,
      statusText: 'Method Not Allowed',
      headers: new Headers(),
    } as unknown as Response);

    // Auth retry POST → still 405 (server truly doesn't accept POST)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 405,
      statusText: 'Method Not Allowed',
      headers: new Headers(),
    } as unknown as Response);

    // SSE fallback connect
    mockFetch.mockResolvedValueOnce(createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]));

    // SSE fallback POST
    mockFetch.mockResolvedValueOnce({ ok: true });

    const promise = transport.request('initialize');
    await promise.catch(() => {});

    // call[0]=POST(405), call[1]=retry POST(405), call[2]=SSE GET
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockAuth.authorize).toHaveBeenCalled();
  }, 10_000);

  it('auto-creates OAuth2 client on 401 without explicit auth config', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    // Server returns 401 — transport should auto-create McpOAuth2Client
    // and attempt to fetch resource metadata (which will fail in test)
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
      } as unknown as Response)
      // fetchResourceMetadata call
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          resource: 'http://localhost:3000/mcp',
          authorization_servers: ['https://auth.example.com'],
        }),
      } as unknown as Response)
      // fetchAuthServerMetadata call
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
        }),
      } as unknown as Response);

    // authorize() will try to start a callback server and open a browser —
    // this will hang in tests, so we just verify the auto-create triggers
    // by catching the eventual error (browser won't open in CI)
    await expect(transport.request('test')).rejects.toThrow();
    // The key assertion: more than 1 fetch call means auth discovery was attempted
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws on HTTP error in request', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
    } as unknown as Response);

    await expect(transport.request('test')).rejects.toThrow('HTTP request failed: 500');
  });
});
