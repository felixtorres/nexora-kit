import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentLoop, ChatEvent } from '@nexora-kit/core';
import type { AuthProvider, AuthIdentity } from './types.js';
import { wsChatMessageSchema, wsPingMessageSchema, wsCancelMessageSchema } from './types.js';
import { computeAcceptKey, decodeFrame, encodeFrame, sendJsonFrame, type DecodedFrame } from './ws-utils.js';

export interface WsConnection {
  id: string;
  socket: Socket;
  auth: AuthIdentity;
  alive: boolean;
  messageTimestamps: number[];
  activeChats: number;
  activeAbortControllers: Map<string, AbortController>;
}

export interface WsRateLimitConfig {
  maxMessagesPerMinute?: number;
  maxConcurrentChats?: number;
  maxConnectionsPerUser?: number;
}

export class WebSocketManager {
  private connections = new Map<string, WsConnection>();
  private userConnectionCount = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly agentLoop: AgentLoop;
  private readonly auth: AuthProvider;
  private readonly heartbeatMs: number;
  private readonly rateLimits: WsRateLimitConfig;
  private nextId = 1;

  constructor(options: {
    agentLoop: AgentLoop;
    auth: AuthProvider;
    heartbeatMs?: number;
    rateLimits?: WsRateLimitConfig;
  }) {
    this.agentLoop = options.agentLoop;
    this.auth = options.auth;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.rateLimits = options.rateLimits ?? {};
  }

  async handleUpgrade(req: IncomingMessage, socket: Socket): Promise<void> {
    // Authenticate — parse query params since WS can't send custom headers
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }

    // Synthesize Authorization header from ?token= if no header present
    if (!headers['authorization'] && query.token) {
      headers['authorization'] = `Bearer ${query.token}`;
    }

    const identity = await this.auth.authenticate({
      method: 'GET',
      url: url.pathname,
      headers,
      params: {},
      query,
    });

    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Per-user connection limit
    if (this.rateLimits.maxConnectionsPerUser) {
      const currentCount = this.userConnectionCount.get(identity.userId) ?? 0;
      if (currentCount >= this.rateLimits.maxConnectionsPerUser) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = computeAcceptKey(key);

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
    );

    const connId = `ws-${this.nextId++}`;
    const conn: WsConnection = {
      id: connId,
      socket,
      auth: identity,
      alive: true,
      messageTimestamps: [],
      activeChats: 0,
      activeAbortControllers: new Map(),
    };
    this.connections.set(connId, conn);

    // Track per-user connections
    this.userConnectionCount.set(
      identity.userId,
      (this.userConnectionCount.get(identity.userId) ?? 0) + 1,
    );

    socket.on('data', (data: Buffer) => {
      this.handleData(conn, data);
    });

    const removeConnection = () => {
      this.connections.delete(connId);
      const count = this.userConnectionCount.get(identity.userId) ?? 1;
      if (count <= 1) {
        this.userConnectionCount.delete(identity.userId);
      } else {
        this.userConnectionCount.set(identity.userId, count - 1);
      }
    };

    socket.on('close', removeConnection);
    socket.on('error', removeConnection);
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      for (const [id, conn] of this.connections) {
        if (!conn.alive) {
          conn.socket.destroy();
          this.connections.delete(id);
          continue;
        }
        conn.alive = false;
        conn.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); // Ping
      }
    }, this.heartbeatMs);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getUserConnectionCount(userId: string): number {
    return this.userConnectionCount.get(userId) ?? 0;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      // Send close frame
      conn.socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      conn.socket.destroy();
    }
    this.connections.clear();
    this.userConnectionCount.clear();
  }

  private handleData(conn: WsConnection, data: Buffer): void {
    const frame = decodeFrame(data);
    if (!frame) return;

    // Pong
    if (frame.opcode === 0xA) {
      conn.alive = true;
      return;
    }

    // Close
    if (frame.opcode === 0x8) {
      conn.socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      conn.socket.destroy();
      this.connections.delete(conn.id);
      return;
    }

    // Text frame
    if (frame.opcode !== 0x1) return;

    // Per-connection message rate limit
    if (this.rateLimits.maxMessagesPerMinute) {
      const now = Date.now();
      const windowStart = now - 60_000;
      conn.messageTimestamps = conn.messageTimestamps.filter((t) => t > windowStart);
      if (conn.messageTimestamps.length >= this.rateLimits.maxMessagesPerMinute) {
        sendJsonFrame(conn.socket, { type: 'error', message: 'Message rate limit exceeded' });
        return;
      }
      conn.messageTimestamps.push(now);
    }

    let message: unknown;
    try {
      message = JSON.parse(frame.payload.toString());
    } catch {
      sendJsonFrame(conn.socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    // Ping message
    const pingResult = wsPingMessageSchema.safeParse(message);
    if (pingResult.success) {
      sendJsonFrame(conn.socket, { type: 'pong' });
      return;
    }

    // Cancel message
    const cancelResult = wsCancelMessageSchema.safeParse(message);
    if (cancelResult.success) {
      const controller = conn.activeAbortControllers.get(cancelResult.data.conversationId);
      if (controller) {
        controller.abort();
        conn.activeAbortControllers.delete(cancelResult.data.conversationId);
      }
      return;
    }

    // Chat message
    const chatResult = wsChatMessageSchema.safeParse(message);
    if (chatResult.success) {
      // Per-connection concurrent chat cap
      if (this.rateLimits.maxConcurrentChats && conn.activeChats >= this.rateLimits.maxConcurrentChats) {
        sendJsonFrame(conn.socket, { type: 'error', message: 'Too many concurrent chats' });
        return;
      }
      this.handleChat(conn, chatResult.data).catch(() => {
        sendJsonFrame(conn.socket, { type: 'error', message: 'Chat processing failed' });
      });
      return;
    }

    sendJsonFrame(conn.socket, { type: 'error', message: 'Unknown message type' });
  }

  private async handleChat(
    conn: WsConnection,
    msg: { conversationId?: string; input: string | { type: string; [key: string]: unknown }; pluginNamespaces?: string[]; metadata?: Record<string, unknown> },
  ): Promise<void> {
    conn.activeChats++;
    const conversationId = msg.conversationId ?? `ws-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    conn.activeAbortControllers.set(conversationId, abortController);

    try {
      // Normalize input: string shorthand → ChatInputText
      const chatInput = typeof msg.input === 'string'
        ? { type: 'text' as const, text: msg.input }
        : msg.input as { type: 'text'; text: string };

      sendJsonFrame(conn.socket, { type: 'conversation', conversationId });

      for await (const event of this.agentLoop.run({
        conversationId,
        input: chatInput,
        teamId: conn.auth.teamId,
        userId: conn.auth.userId,
        pluginNamespaces: msg.pluginNamespaces,
        metadata: msg.metadata,
      }, abortController.signal)) {
        if (conn.socket.destroyed || abortController.signal.aborted) break;
        // Envelope: { type, conversationId, payload }
        sendJsonFrame(conn.socket, { type: event.type, conversationId, payload: event });
      }

      if (abortController.signal.aborted) {
        sendJsonFrame(conn.socket, { type: 'cancelled', conversationId });
      }
    } finally {
      conn.activeChats--;
      conn.activeAbortControllers.delete(conversationId);
    }
  }
}

/** Check if an HTTP request is a WebSocket upgrade */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers['upgrade'];
  return upgrade?.toLowerCase() === 'websocket';
}
