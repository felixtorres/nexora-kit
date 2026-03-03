import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClientWebSocketManager, type ClientWsManagerDeps } from './client-websocket.js';
import { decodeFrame } from './ws-utils.js';

function makeMockSocket(): EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; destroyed: boolean } {
  const emitter = new EventEmitter() as any;
  emitter.write = vi.fn();
  emitter.destroy = vi.fn(() => { emitter.destroyed = true; });
  emitter.destroyed = false;
  return emitter;
}

function makeMockReq(slug: string, key?: string, headers?: Record<string, string>) {
  return {
    headers: {
      'sec-websocket-key': key ?? 'dGhlIHNhbXBsZSBub25jZQ==',
      upgrade: 'websocket',
      connection: 'Upgrade',
      'x-end-user-id': 'eu-1',
      ...headers,
    },
    url: `/v1/agents/${slug}/ws`,
  } as any;
}

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

function encodeClientFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  const header = Buffer.alloc(6 + payload.length);
  header[0] = 0x81; // FIN + text
  header[1] = 0x80 | payload.length; // masked + length
  mask.copy(header, 2);
  masked.copy(header, 6);
  return header;
}

function parseFrame(buf: Buffer): any {
  const decoded = decodeFrame(buf);
  if (!decoded) return null;
  return JSON.parse(decoded.payload.toString());
}

describe('ClientWebSocketManager', () => {
  let manager: ClientWebSocketManager;

  afterEach(() => {
    manager?.stopHeartbeat();
    manager?.closeAll();
  });

  it('rejects when agent not found (404)', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(null),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('unknown-agent'), socket as any);

    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('404');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects when agent is disabled (404)', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore({ ...defaultAgent, enabled: false }),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);

    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('404');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects when auth fails (401)', async () => {
    const failStore = {
      getOrCreate: vi.fn().mockRejectedValue(new Error('Auth failed')),
    } as any;

    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: failStore,
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    // No x-end-user-id header → anonymous auth will fail
    const req = {
      headers: {
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        upgrade: 'websocket',
      },
      url: '/v1/agents/my-agent/ws',
    } as any;
    await manager.handleUpgrade(req, socket as any);

    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('401');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('performs valid handshake', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);

    expect(socket.write).toHaveBeenCalledOnce();
    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('101 Switching Protocols');
    expect(response).toContain('Sec-WebSocket-Accept');
    expect(manager.getConnectionCount()).toBe(1);
  });

  it('stores agent context on connection', async () => {
    const agentLoop = makeMockAgentLoop([{ type: 'text', content: 'Hi!' }, { type: 'done' }]);
    const deps: ClientWsManagerDeps = {
      agentLoop,
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    // Send chat message
    const frame = encodeClientFrame(JSON.stringify({
      type: 'chat',
      input: 'Hello',
    }));
    socket.emit('data', frame);
    await new Promise((r) => setTimeout(r, 50));

    // agentLoop.run should be called with correct teamId from agent
    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        userId: 'eu-internal-1',
      }),
      expect.any(AbortSignal),
    );
  });

  it('streams chat events to client', async () => {
    const events = [
      { type: 'text', content: 'Hello!' },
      { type: 'done' },
    ];
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(events),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    const frame = encodeClientFrame(JSON.stringify({
      type: 'chat',
      input: 'Hi',
      conversationId: 'conv-1',
    }));
    socket.emit('data', frame);
    await new Promise((r) => setTimeout(r, 50));

    // Should have: conversation, text, done
    expect(socket.write.mock.calls.length).toBeGreaterThanOrEqual(3);

    const firstMsg = parseFrame(socket.write.mock.calls[0][0] as Buffer);
    expect(firstMsg.type).toBe('conversation');
    expect(firstMsg.conversationId).toBe('conv-1');
  });

  it('enforces message rate limit', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      rateLimits: { maxMessagesPerMinute: 2 },
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    // Send 2 pings (should succeed)
    for (let i = 0; i < 2; i++) {
      socket.emit('data', encodeClientFrame(JSON.stringify({ type: 'ping' })));
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(socket.write.mock.calls.length).toBe(2);

    // 3rd should be rate limited
    socket.write.mockClear();
    socket.emit('data', encodeClientFrame(JSON.stringify({ type: 'ping' })));
    await new Promise((r) => setTimeout(r, 5));

    const msg = parseFrame(socket.write.mock.calls[0][0] as Buffer);
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('rate limit');
  });

  it('enforces per end-user connection limit', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      rateLimits: { maxConnectionsPerEndUser: 1 },
    };
    manager = new ClientWebSocketManager(deps);

    const s1 = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent', 'key1'), s1 as any);
    expect(manager.getConnectionCount()).toBe(1);

    // Second connection — should be rejected
    const s2 = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent', 'key2'), s2 as any);

    const response = s2.write.mock.calls[0][0] as string;
    expect(response).toContain('429');
    expect(s2.destroy).toHaveBeenCalled();
    expect(manager.getConnectionCount()).toBe(1);
  });

  it('responds to ping messages', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    socket.emit('data', encodeClientFrame(JSON.stringify({ type: 'ping' })));
    await new Promise((r) => setTimeout(r, 10));

    const msg = parseFrame(socket.write.mock.calls[0][0] as Buffer);
    expect(msg).toEqual({ type: 'pong' });
  });

  it('handles cancel messages', async () => {
    let abortSignal: AbortSignal | undefined;
    const slowLoop = {
      run: vi.fn().mockImplementation(async function* (_req: any, signal?: AbortSignal) {
        abortSignal = signal;
        yield { type: 'text', content: 'start' };
        // Wait until aborted
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { resolve(); return; }
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
      abort: vi.fn(),
    } as any;

    const deps: ClientWsManagerDeps = {
      agentLoop: slowLoop,
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    // Start chat
    socket.emit('data', encodeClientFrame(JSON.stringify({
      type: 'chat',
      input: 'Hello',
      conversationId: 'conv-cancel',
    })));
    await new Promise((r) => setTimeout(r, 30));

    // Cancel
    socket.emit('data', encodeClientFrame(JSON.stringify({
      type: 'cancel',
      conversationId: 'conv-cancel',
    })));
    await new Promise((r) => setTimeout(r, 100));

    // The abort signal should have fired
    expect(abortSignal?.aborted).toBe(true);

    // Should have received cancelled
    const allMessages = socket.write.mock.calls.map((c) => {
      try {
        return parseFrame(c[0] as Buffer);
      } catch { return null; }
    }).filter(Boolean);

    expect(allMessages.some((m) => m.type === 'cancelled')).toBe(true);
  });

  it('verifies conversation ownership when store available', async () => {
    const convStore = {
      get: vi.fn().mockResolvedValue(null), // Not found → ownership check fails
    } as any;

    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
      conversationStore: convStore,
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    socket.write.mockClear();

    socket.emit('data', encodeClientFrame(JSON.stringify({
      type: 'chat',
      input: 'Hello',
      conversationId: 'someone-elses-conv',
    })));
    await new Promise((r) => setTimeout(r, 50));

    const messages = socket.write.mock.calls.map((c) => {
      try { return parseFrame(c[0] as Buffer); } catch { return null; }
    }).filter(Boolean);

    expect(messages.some((m) => m.type === 'error' && m.message.includes('not found'))).toBe(true);
  });

  it('handles close frame', async () => {
    const deps: ClientWsManagerDeps = {
      agentLoop: makeMockAgentLoop(),
      agentStore: makeMockAgentStore(defaultAgent),
      endUserStore: makeMockEndUserStore(),
    };
    manager = new ClientWebSocketManager(deps);

    const socket = makeMockSocket();
    await manager.handleUpgrade(makeMockReq('my-agent'), socket as any);
    expect(manager.getConnectionCount()).toBe(1);

    // Send close frame (opcode 0x8)
    const closeFrame = Buffer.alloc(6);
    closeFrame[0] = 0x88; // FIN + close
    closeFrame[1] = 0x80; // masked, 0 length
    closeFrame[2] = 0; closeFrame[3] = 0; closeFrame[4] = 0; closeFrame[5] = 0; // mask
    socket.emit('data', closeFrame);

    expect(socket.destroy).toHaveBeenCalled();
    expect(manager.getConnectionCount()).toBe(0);
  });
});
