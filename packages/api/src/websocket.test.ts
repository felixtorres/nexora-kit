import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketManager, isWebSocketUpgrade } from './websocket.js';
import type { AuthIdentity } from './types.js';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB9B6FF85B5';

function makeMockSocket(): EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; destroyed: boolean } {
  const emitter = new EventEmitter() as any;
  emitter.write = vi.fn();
  emitter.destroy = vi.fn(() => { emitter.destroyed = true; });
  emitter.destroyed = false;
  return emitter;
}

function makeMockReq(key?: string, authHeader?: string) {
  return {
    headers: {
      'sec-websocket-key': key ?? 'dGhlIHNhbXBsZSBub25jZQ==',
      upgrade: 'websocket',
      connection: 'Upgrade',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    url: '/ws',
  } as any;
}

function makeMockAuth(identity: AuthIdentity | null = { userId: 'u1', teamId: 't1', role: 'user' }) {
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

describe('WebSocketManager', () => {
  let wsm: WebSocketManager;

  afterEach(() => {
    wsm?.stopHeartbeat();
    wsm?.closeAll();
  });

  it('performs WebSocket handshake', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const req = makeMockReq(key, 'Bearer token');

    await wsm.handleUpgrade(req, socket as any);

    expect(socket.write).toHaveBeenCalledOnce();
    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('101 Switching Protocols');

    const expectedAccept = createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');
    expect(response).toContain(`Sec-WebSocket-Accept: ${expectedAccept}`);
    expect(wsm.getConnectionCount()).toBe(1);
  });

  it('rejects unauthenticated connections', async () => {
    const auth = makeMockAuth(null);
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);

    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('401');
    expect(socket.destroy).toHaveBeenCalled();
    expect(wsm.getConnectionCount()).toBe(0);
  });

  it('rejects requests without sec-websocket-key', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    const req = { headers: { upgrade: 'websocket' }, url: '/ws' } as any;
    await wsm.handleUpgrade(req, socket as any);

    const response = socket.write.mock.calls[0][0] as string;
    expect(response).toContain('400');
  });

  it('handles ping messages with pong', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    socket.write.mockClear();

    const frame = encodeClientFrame(JSON.stringify({ type: 'ping' }));
    socket.emit('data', frame);

    // Wait for async handling
    await new Promise((r) => setTimeout(r, 10));

    expect(socket.write).toHaveBeenCalled();
    // Response should contain pong JSON
    const written = socket.write.mock.calls[0][0] as Buffer;
    const payload = written.subarray(2); // skip header
    expect(JSON.parse(payload.toString())).toEqual({ type: 'pong' });
  });

  it('handles chat messages and streams events', async () => {
    const events = [
      { type: 'text', content: 'Hello!' },
      { type: 'done' },
    ];
    const agentLoop = makeMockAgentLoop(events);
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop, auth });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    socket.write.mockClear();

    const frame = encodeClientFrame(JSON.stringify({
      type: 'chat',
      message: 'Hi',
      sessionId: 'sess-1',
    }));
    socket.emit('data', frame);

    await new Promise((r) => setTimeout(r, 50));

    // Should send: session event, text event, done event
    expect(socket.write.mock.calls.length).toBeGreaterThanOrEqual(3);

    // First message: session ID
    const firstPayload = socket.write.mock.calls[0][0] as Buffer;
    const sessionMsg = JSON.parse(firstPayload.subarray(2).toString());
    expect(sessionMsg.type).toBe('session');
    expect(sessionMsg.sessionId).toBe('sess-1');
  });

  it('sends error for invalid JSON', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    socket.write.mockClear();

    const frame = encodeClientFrame('not json');
    socket.emit('data', frame);

    await new Promise((r) => setTimeout(r, 10));

    const written = socket.write.mock.calls[0][0] as Buffer;
    const msg = JSON.parse(written.subarray(2).toString());
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('Invalid JSON');
  });

  it('removes connection on socket close', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    expect(wsm.getConnectionCount()).toBe(1);

    socket.emit('close');
    expect(wsm.getConnectionCount()).toBe(0);
  });

  it('closeAll destroys all connections', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({ agentLoop: makeMockAgentLoop(), auth });

    const s1 = makeMockSocket();
    const s2 = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq('key1'), s1 as any);
    await wsm.handleUpgrade(makeMockReq('key2'), s2 as any);
    expect(wsm.getConnectionCount()).toBe(2);

    wsm.closeAll();
    expect(wsm.getConnectionCount()).toBe(0);
    expect(s1.destroy).toHaveBeenCalled();
    expect(s2.destroy).toHaveBeenCalled();
  });

  // --- WS rate limit tests ---

  it('enforces per-connection message rate limit', async () => {
    const auth = makeMockAuth();
    wsm = new WebSocketManager({
      agentLoop: makeMockAgentLoop(),
      auth,
      rateLimits: { maxMessagesPerMinute: 3 },
    });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    socket.write.mockClear();

    // Send 3 messages (should all succeed)
    for (let i = 0; i < 3; i++) {
      const frame = encodeClientFrame(JSON.stringify({ type: 'ping' }));
      socket.emit('data', frame);
      await new Promise((r) => setTimeout(r, 5));
    }

    const successCalls = socket.write.mock.calls.length;
    // All 3 should get pong responses
    expect(successCalls).toBe(3);

    // 4th message should be rate limited
    socket.write.mockClear();
    const frame = encodeClientFrame(JSON.stringify({ type: 'ping' }));
    socket.emit('data', frame);
    await new Promise((r) => setTimeout(r, 5));

    const written = socket.write.mock.calls[0][0] as Buffer;
    const msg = JSON.parse(written.subarray(2).toString());
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('rate limit');
  });

  it('enforces per-connection concurrent chat cap', async () => {
    // Agent loop that never resolves
    const neverResolve = {
      run: vi.fn().mockImplementation(async function* () {
        yield { type: 'session' };
        await new Promise(() => {}); // Never resolves
      }),
      abort: vi.fn(),
    } as any;

    const auth = makeMockAuth();
    wsm = new WebSocketManager({
      agentLoop: neverResolve,
      auth,
      rateLimits: { maxConcurrentChats: 1 },
    });

    const socket = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq(), socket as any);
    socket.write.mockClear();

    // Start first chat
    const frame1 = encodeClientFrame(JSON.stringify({ type: 'chat', message: 'Hello' }));
    socket.emit('data', frame1);
    await new Promise((r) => setTimeout(r, 20));

    // Try second chat — should be rejected
    socket.write.mockClear();
    const frame2 = encodeClientFrame(JSON.stringify({ type: 'chat', message: 'Second' }));
    socket.emit('data', frame2);
    await new Promise((r) => setTimeout(r, 10));

    const lastCall = socket.write.mock.calls[socket.write.mock.calls.length - 1];
    const written = lastCall[0] as Buffer;
    const msg = JSON.parse(written.subarray(2).toString());
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('concurrent');
  });

  it('enforces per-user connection limit', async () => {
    const auth = makeMockAuth({ userId: 'user-1', teamId: 't1', role: 'user' });
    wsm = new WebSocketManager({
      agentLoop: makeMockAgentLoop(),
      auth,
      rateLimits: { maxConnectionsPerUser: 1 },
    });

    const s1 = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq('key1'), s1 as any);
    expect(wsm.getConnectionCount()).toBe(1);

    // Second connection for same user should be rejected
    const s2 = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq('key2'), s2 as any);

    const response = s2.write.mock.calls[0][0] as string;
    expect(response).toContain('429');
    expect(s2.destroy).toHaveBeenCalled();
    expect(wsm.getConnectionCount()).toBe(1);
  });

  it('tracks user connection count and decrements on close', async () => {
    const auth = makeMockAuth({ userId: 'user-1', teamId: 't1', role: 'user' });
    wsm = new WebSocketManager({
      agentLoop: makeMockAgentLoop(),
      auth,
      rateLimits: { maxConnectionsPerUser: 2 },
    });

    const s1 = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq('key1'), s1 as any);
    expect(wsm.getUserConnectionCount('user-1')).toBe(1);

    const s2 = makeMockSocket();
    await wsm.handleUpgrade(makeMockReq('key2'), s2 as any);
    expect(wsm.getUserConnectionCount('user-1')).toBe(2);

    // Close first socket — count should decrement
    s1.emit('close');
    expect(wsm.getUserConnectionCount('user-1')).toBe(1);
    expect(wsm.getConnectionCount()).toBe(1);
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
