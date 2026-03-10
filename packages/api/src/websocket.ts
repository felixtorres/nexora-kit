import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentLoop } from '@nexora-kit/core';
import type { IConversationStore } from '@nexora-kit/storage';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { AuthProvider, AuthIdentity } from './types.js';
import { wsChatMessageSchema, wsPingMessageSchema, wsCancelMessageSchema } from './types.js';

export interface WsConnection {
  id: string;
  socket: WebSocket;
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
  private readonly conversationStore?: IConversationStore;
  private readonly heartbeatMs: number;
  private readonly rateLimits: WsRateLimitConfig;
  private readonly server = new WebSocketServer({ noServer: true });
  private nextId = 1;

  constructor(options: {
    agentLoop: AgentLoop;
    auth: AuthProvider;
    conversationStore?: IConversationStore;
    heartbeatMs?: number;
    rateLimits?: WsRateLimitConfig;
  }) {
    this.agentLoop = options.agentLoop;
    this.auth = options.auth;
    this.conversationStore = options.conversationStore;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.rateLimits = options.rateLimits ?? {};
  }

  async handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer = Buffer.alloc(0),
  ): Promise<void> {
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }

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
      const origin = req.headers['origin'] ?? '*';
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' + `Access-Control-Allow-Origin: ${origin}\r\n` + '\r\n',
      );
      socket.destroy();
      console.error(
        `[ws] auth failed for ${url.pathname} hasToken=${!!query.token} origin=${origin}`,
      );
      return;
    }

    if (this.rateLimits.maxConnectionsPerUser) {
      const currentCount = this.userConnectionCount.get(identity.userId) ?? 0;
      if (currentCount >= this.rateLimits.maxConnectionsPerUser) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    this.server.handleUpgrade(req, socket, head, (ws) => {
      this.attachConnection(ws, identity);
    });
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      for (const conn of this.connections.values()) {
        if (!conn.alive) {
          conn.socket.terminate();
          continue;
        }
        conn.alive = false;
        if (conn.socket.readyState === WebSocket.OPEN) {
          conn.socket.ping();
        }
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
      for (const controller of conn.activeAbortControllers.values()) {
        controller.abort();
      }
      conn.socket.close();
    }
    this.connections.clear();
    this.userConnectionCount.clear();
  }

  private attachConnection(ws: WebSocket, identity: AuthIdentity): void {
    const connId = `ws-${this.nextId++}`;
    const conn: WsConnection = {
      id: connId,
      socket: ws,
      auth: identity,
      alive: true,
      messageTimestamps: [],
      activeChats: 0,
      activeAbortControllers: new Map(),
    };
    this.connections.set(connId, conn);
    this.userConnectionCount.set(
      identity.userId,
      (this.userConnectionCount.get(identity.userId) ?? 0) + 1,
    );

    let removed = false;
    const removeConnection = () => {
      if (removed) return;
      removed = true;
      this.connections.delete(connId);
      for (const controller of conn.activeAbortControllers.values()) {
        controller.abort();
      }
      conn.activeAbortControllers.clear();
      const count = this.userConnectionCount.get(identity.userId) ?? 1;
      if (count <= 1) {
        this.userConnectionCount.delete(identity.userId);
      } else {
        this.userConnectionCount.set(identity.userId, count - 1);
      }
    };

    ws.on('message', (data, isBinary) => {
      this.handleMessage(conn, data, isBinary);
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('close', removeConnection);
    ws.on('error', removeConnection);
  }

  private handleMessage(conn: WsConnection, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      conn.socket.close(1003, 'Binary frames not supported');
      return;
    }

    if (this.rateLimits.maxMessagesPerMinute) {
      const now = Date.now();
      const windowStart = now - 60_000;
      conn.messageTimestamps = conn.messageTimestamps.filter((t) => t > windowStart);
      if (conn.messageTimestamps.length >= this.rateLimits.maxMessagesPerMinute) {
        sendJson(conn.socket, { type: 'rate_limited', message: 'Message rate limit exceeded' });
        return;
      }
      conn.messageTimestamps.push(now);
    }

    let message: unknown;
    try {
      message = JSON.parse(rawDataToString(data));
    } catch {
      sendJson(conn.socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const pingResult = wsPingMessageSchema.safeParse(message);
    if (pingResult.success) {
      sendJson(conn.socket, { type: 'pong' });
      return;
    }

    const cancelResult = wsCancelMessageSchema.safeParse(message);
    if (cancelResult.success) {
      const controller = conn.activeAbortControllers.get(cancelResult.data.conversationId);
      if (controller) {
        controller.abort();
        conn.activeAbortControllers.delete(cancelResult.data.conversationId);
      }
      return;
    }

    const chatResult = wsChatMessageSchema.safeParse(message);
    if (chatResult.success) {
      if (
        this.rateLimits.maxConcurrentChats &&
        conn.activeChats >= this.rateLimits.maxConcurrentChats
      ) {
        sendJson(conn.socket, { type: 'error', message: 'Too many concurrent chats' });
        return;
      }
      this.handleChat(conn, chatResult.data).catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[ws] handleChat error:', detail);
        sendJson(conn.socket, { type: 'error', message: `Chat processing failed: ${detail}` });
      });
      return;
    }

    sendJson(conn.socket, { type: 'error', message: 'Unknown message type' });
  }

  private async handleChat(
    conn: WsConnection,
    msg: {
      conversationId?: string;
      input: string | { type: string; [key: string]: unknown };
      pluginNamespaces?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    conn.activeChats++;
    const conversationId =
      msg.conversationId ?? `ws-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    conn.activeAbortControllers.set(conversationId, abortController);

    try {
      const chatInput =
        typeof msg.input === 'string'
          ? { type: 'text' as const, text: msg.input }
          : (msg.input as { type: 'text'; text: string });

      sendJson(conn.socket, { type: 'conversation', conversationId });

      for await (const event of this.agentLoop.run(
        {
          conversationId,
          input: chatInput,
          teamId: conn.auth.teamId,
          userId: conn.auth.userId,
          pluginNamespaces: msg.pluginNamespaces,
          metadata: msg.metadata,
        },
        abortController.signal,
      )) {
        if (conn.socket.readyState !== WebSocket.OPEN || abortController.signal.aborted) break;
        sendJson(conn.socket, { type: event.type, conversationId, payload: event });
      }

      if (abortController.signal.aborted) {
        sendJson(conn.socket, { type: 'cancelled', conversationId });
      }

      // Auto-title: set conversation title from first user message if not already set
      if (this.conversationStore) {
        try {
          const conversation = await this.conversationStore.get(conversationId, conn.auth.userId);
          if (conversation && !conversation.title) {
            const inputText = typeof msg.input === 'string' ? msg.input : (chatInput.text ?? '');
            if (inputText) {
              const title = inputText.length > 80 ? inputText.slice(0, 77) + '...' : inputText;
              await this.conversationStore.update(conversationId, conn.auth.userId, { title });
            }
          }
        } catch {
          // Best-effort — don't fail the chat
        }
      }
    } finally {
      conn.activeChats--;
      conn.activeAbortControllers.delete(conversationId);
    }
  }
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString();
}

function sendJson(socket: WebSocket, data: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(data));
}

/** Check if an HTTP request is a WebSocket upgrade */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers['upgrade'];
  return upgrade?.toLowerCase() === 'websocket';
}
