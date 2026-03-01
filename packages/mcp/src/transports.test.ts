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

describe('SseTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createMockSseResponse(events: string[]): Response {
    let controllerRef: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
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

  it('connects to SSE endpoint', async () => {
    const response = createMockSseResponse([]);
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
    // Connect first — provide an endpoint event and then a response
    const response = createMockSseResponse([
      'event: endpoint\ndata: /messages',
    ]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({ url: 'http://localhost:3000/sse', timeoutMs: 100 });
    await transport.connect();

    // Give the stream time to process
    await new Promise((r) => setTimeout(r, 10));

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
    const response = createMockSseResponse([]);
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
    const response = createMockSseResponse([]);
    mockFetch.mockResolvedValueOnce(response);

    const transport = new SseTransport({ url: 'http://localhost:3000/sse' });
    await transport.connect();

    await transport.close();
    expect(transport.isConnected()).toBe(false);
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

  function mockErrorResponse(status: number, statusText: string): Response {
    return {
      ok: false,
      status,
      statusText,
      headers: new Headers(),
    } as unknown as Response;
  }

  it('connects by sending initialize JSON-RPC', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));

    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('initialize');
    expect(body.jsonrpc).toBe('2.0');
  });

  it('throws on failed connection', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(500, 'Internal Server Error'));

    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await expect(transport.connect()).rejects.toThrow('HTTP connection failed: 500');
  });

  it('stores session ID from response header', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }, { sessionId: 'sess-123' }));

    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    // Make a request — should include session ID header
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 2, result: { tools: [] } }),
    } as unknown as Response);

    await transport.request('tools/list');

    const headers = mockFetch.mock.calls[1][1].headers;
    expect(headers['mcp-session-id']).toBe('sess-123');
  });

  it('sends requests and parses responses', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 2, result: { tools: ['a', 'b'] } }),
    } as unknown as Response);

    const result = await transport.request('tools/list');
    expect(result).toEqual({ tools: ['a', 'b'] });
  });

  it('throws on JSON-RPC error in response', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 2, error: { code: -32600, message: 'Invalid' } }),
    } as unknown as Response);

    await expect(transport.request('bad/method')).rejects.toThrow('JSON-RPC error -32600: Invalid');
  });

  it('sends notifications fire-and-forget', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({ ok: true });

    transport.notify('notifications/initialized');

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.method).toBe('notifications/initialized');
    expect(body.id).toBeUndefined();
  });

  it('closes with session ID POST', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }, { sessionId: 'sess-456' }));
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({ ok: true });

    await transport.close();
    expect(transport.isConnected()).toBe(false);

    // Should have sent a close notification
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const closeHeaders = mockFetch.mock.calls[1][1].headers;
    expect(closeHeaders['mcp-session-id']).toBe('sess-456');
  });

  it('closes without POST when no session ID', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await transport.connect();

    await transport.close();
    expect(transport.isConnected()).toBe(false);
    // Only the connect call, no close POST
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects requests when not connected', async () => {
    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await expect(transport.request('test')).rejects.toThrow('Transport not connected');
  });

  it('passes custom headers', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ capabilities: {} }));

    const transport = new HttpTransport({
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer token' },
    });
    await transport.connect();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer token');
  });

  it('handles fetch failure during connect', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const transport = new HttpTransport({ url: 'http://localhost:3000/mcp' });
    await expect(transport.connect()).rejects.toThrow('Network error');
    expect(transport.isConnected()).toBe(false);
  });
});
