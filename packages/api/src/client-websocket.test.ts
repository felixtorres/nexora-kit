import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ClientWebSocketManager, type ClientWsManagerDeps } from './client-websocket.js';

function makeMockAgentLoop(events: any[] = [{ type: 'done' }]) {
  return {
    run: vi.fn().mockImplementation(async function* () {
      for (const e of events) yield e;
    }),
    abort: vi.fn(),
  } as any;
}

function makeMockAgentStore(agent: any = null) {
  return {
    get: vi.fn().mockResolvedValue(agent),
    getBySlugGlobal: vi.fn().mockResolvedValue(agent),
  } as any;
}

function makeMockEndUserStore() {
  return {
    getOrCreate: vi.fn().mockResolvedValue({
      id: 'eu-internal-1',
      agentId: 'agent-1',
      externalId: 'eu-1',
      displayName: null,
    }),
  } as any;
}

const defaultAgent = {
  id: 'agent-1',
  teamId: 'team-1',
  slug: 'my-agent',
  name: 'My Agent',
  enabled: true,
  endUserAuth: { mode: 'anonymous' as const },
  rateLimits: {},
};

async function startClientWsServer(manager: ClientWebSocketManager) {
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
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

async function connectExpectHttpError(
  url: string,
  options?: { headers?: Record<string, string> },
): Promise<number | undefined> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: options?.headers });
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

describe('ClientWebSocketManager', () => {
  let manager: ClientWebSocketManager;
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    manager?.stopHeartbeat();
    manager?.closeAll();
    if (shutdown) await shutdown();
    shutdown = undefined;
  });

  it('rejects when agent not found (404)', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(null),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    await expect(
      connectExpectHttpError(`${started.url}/v1/agents/unknown-agent/ws`, {
        headers: { 'x-end-user-id': 'eu-1' },
      }),
    ).resolves.toBe(404);
  });

  it('rejects when auth fails (401)', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    await expect(connectExpectHttpError(`${started.url}/v1/agents/my-agent/ws`)).resolves.toBe(401);
  });

  it('performs a valid handshake', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    expect(manager.getConnectionCount()).toBe(1);
    ws.close();
  });

  it('stores agent context on connection', async () => {
    const agentLoop = makeMockAgentLoop([{ type: 'text', content: 'Hi!' }, { type: 'done' }]);
    const deps: ClientWsManagerDeps = {
      agentLoop,
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    await collectJsonMessages(ws, 3, () => {
      ws.send(JSON.stringify({ type: 'chat', input: 'Hello' }));
    });

    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', userId: 'eu-internal-1' }),
      expect.any(AbortSignal),
    );
    ws.close();
  });

  it('streams chat events to client', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop([{ type: 'text', content: 'Hello!' }, { type: 'done' }]),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
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

  it('enforces message rate limit', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      rateLimits: { maxMessagesPerMinute: 2 },
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    ws.send(JSON.stringify({ type: 'ping' }));
    await nextJsonMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    await nextJsonMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: 'error',
      message: 'Message rate limit exceeded',
    });
    ws.close();
  });

  it('enforces per end-user connection limit', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      rateLimits: { maxConnectionsPerEndUser: 1 },
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    await expect(
      connectExpectHttpError(`${started.url}/v1/agents/my-agent/ws`, {
        headers: { 'x-end-user-id': 'eu-1' },
      }),
    ).resolves.toBe(429);
    ws.close();
  });

  it('handles cancel messages', async () => {
    let abortSignal: AbortSignal | undefined;
    const slowLoop = {
      run: vi.fn().mockImplementation(async function* (_req: any, signal?: AbortSignal) {
        abortSignal = signal;
        yield { type: 'text', content: 'start' };
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
    } as any;
    const deps: ClientWsManagerDeps = {
      agentLoop: slowLoop,
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    const messages = await collectJsonMessages(ws, 3, () => {
      ws.send(JSON.stringify({ type: 'chat', input: 'Hello', conversationId: 'conv-cancel' }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'cancel', conversationId: 'conv-cancel' }));
      }, 10);
    });

    expect(messages[2]).toMatchObject({
      type: 'cancelled',
      conversationId: 'conv-cancel',
    });
    expect(abortSignal?.aborted).toBe(true);
    ws.close();
  });

  it('verifies conversation ownership when store available', async () => {
    const convStore = {
      get: vi.fn().mockResolvedValue(null),
    } as any;
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      conversationStore: convStore,
    };
    manager = new ClientWebSocketManager(deps);
    const started = await startClientWsServer(manager);
    shutdown = started.close;

    const ws = await connectWebSocket(`${started.url}/v1/agents/my-agent/ws`, {
      headers: { 'x-end-user-id': 'eu-1' },
    });
    ws.send(
      JSON.stringify({
        type: 'chat',
        input: 'Hello',
        conversationId: 'someone-elses-conv',
      }),
    );

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: 'error',
      message: 'Conversation not found',
      conversationId: 'someone-elses-conv',
    });
    ws.close();
  });
});
