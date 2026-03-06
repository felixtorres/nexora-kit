import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
import type { AuthIdentity } from './types.js';

function makeMockAuth(
  identity: AuthIdentity | null = { userId: 'u1', teamId: 't1', role: 'user' },
) {
  return {
    authenticate: vi.fn().mockResolvedValue(identity),
  };
}

function makeMockAgentLoop(events: any[] = [{ type: 'done' }]) {
  return {
    run: vi.fn().mockImplementation(async function* () {
      for (const e of events) yield e;
    }),
    abort: vi.fn(),
  } as any;
}

async function startWsServer(manager: WebSocketManager) {
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!isWebSocketUpgrade(req)) {
      socket.destroy();
      return;
    }
    manager.handleUpgrade(req, socket as any, head).catch(() => socket.destroy());
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

  return {
    server,
    url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function connectWebSocket(
  url: string,
  options?: { headers?: Record<string, string> },
): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: options?.headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`Unexpected response: ${res.statusCode}`));
    });
  });
}

async function connectExpectHttpError(url: string): Promise<number | undefined> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode);
    });
    ws.once('open', () => reject(new Error('Expected handshake failure')));
    ws.once('error', () => {});
  });
}

async function nextJsonMessage(ws: WebSocket): Promise<any> {
  const [data] = (await once(ws, 'message')) as [Buffer, boolean];
  return JSON.parse(data.toString());
}

async function collectJsonMessages(
  ws: WebSocket,
  count: number,
  action: () => void,
): Promise<any[]> {
  return await new Promise((resolve, reject) => {
    const messages: any[] = [];
    const onMessage = (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()));
        if (messages.length === count) {
          cleanup();
          resolve(messages);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
    action();
  });
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager;
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    manager?.stopHeartbeat();
    manager?.closeAll();
    if (shutdown) await shutdown();
    shutdown = undefined;
  });

  it('performs a real WebSocket handshake', async () => {
    manager = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth: makeMockAuth() });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=dev-key`);
    expect(manager.getConnectionCount()).toBe(1);

    ws.close();
    await once(ws, 'close');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('rejects unauthenticated connections', async () => {
    manager = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth: makeMockAuth(null) });
    const started = await startWsServer(manager);
    shutdown = started.close;

    await expect(connectExpectHttpError(`${started.url}/v1/ws?token=bad`)).resolves.toBe(401);
  });

  it('handles app-level ping with pong', async () => {
    manager = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth: makeMockAuth() });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=dev-key`);
    ws.send(JSON.stringify({ type: 'ping' }));
    await expect(nextJsonMessage(ws)).resolves.toEqual({ type: 'pong' });
    ws.close();
  });

  it('handles chat messages and streams events', async () => {
    manager = new WebSocketManager({
      agentLoop: makeMockAgentLoop([{ type: 'text', content: 'Hello!' }, { type: 'done' }]),
      auth: makeMockAuth(),
    });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=dev-key`);
    const messages = await collectJsonMessages(ws, 3, () => {
      ws.send(JSON.stringify({ type: 'chat', input: 'Hi', conversationId: 'conv-1' }));
    });

    expect(messages[0]).toMatchObject({
      type: 'conversation',
      conversationId: 'conv-1',
    });
    expect(messages[1]).toMatchObject({
      type: 'text',
      conversationId: 'conv-1',
      payload: { type: 'text', content: 'Hello!' },
    });
    expect(messages[2]).toMatchObject({
      type: 'done',
      conversationId: 'conv-1',
    });
    ws.close();
  });

  it('sends error for invalid JSON', async () => {
    manager = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth: makeMockAuth() });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=dev-key`);
    ws.send('not json');
    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: 'error',
      message: 'Invalid JSON',
    });
    ws.close();
  });

  it('enforces per-user connection limit', async () => {
    manager = new WebSocketManager({
      agentLoop: makeMockAgentLoop(),
      auth: makeMockAuth({ userId: 'user-1', teamId: 't1', role: 'user' }),
      rateLimits: { maxConnectionsPerUser: 1 },
    });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=first`);
    await expect(connectExpectHttpError(`${started.url}/v1/ws?token=second`)).resolves.toBe(429);
    expect(manager.getUserConnectionCount('user-1')).toBe(1);
    ws.close();
  });

  it('enforces per-connection concurrent chat cap', async () => {
    const agentLoop = {
      run: vi.fn().mockImplementation(async function* () {
        yield { type: 'session' };
        await new Promise(() => {});
      }),
    } as any;
    manager = new WebSocketManager({
      agentLoop,
      auth: makeMockAuth(),
      rateLimits: { maxConcurrentChats: 1 },
    });
    const started = await startWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/ws?token=dev-key`);
    const messages = await collectJsonMessages(ws, 3, () => {
      ws.send(JSON.stringify({ type: 'chat', input: 'first', conversationId: 'one' }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'chat', input: 'second', conversationId: 'two' }));
      }, 10);
    });

    expect(messages[2]).toMatchObject({
      type: 'error',
      message: 'Too many concurrent chats',
    });
    ws.close();
  });
});

describe('isWebSocketUpgrade', () => {
  it('returns true for websocket upgrade', () => {
    expect(isWebSocketUpgrade({ headers: { upgrade: 'websocket' } } as any)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isWebSocketUpgrade({ headers: { upgrade: 'WebSocket' } } as any)).toBe(true);
  });

  it('returns false for non-upgrade', () => {
    expect(isWebSocketUpgrade({ headers: {} } as any)).toBe(false);
  });
});
