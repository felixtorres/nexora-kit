import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentLoop } from '@nexora-kit/core';
import type { IAgentStore, IEndUserStore, IConversationStore } from '@nexora-kit/storage';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { authenticateEndUser, type EndUserIdentity } from './end-user-auth.js';
import { wsChatMessageSchema, wsPingMessageSchema, wsCancelMessageSchema } from './types.js';

export interface ClientWsConnection {
  id: string;
  socket: WebSocket;
  agentId: string;
  teamId: string;
  endUser: EndUserIdentity;
  alive: boolean;
  messageTimestamps: number[];
  activeChats: number;
  activeAbortControllers: Map<string, AbortController>;
}

export interface ClientWsManagerDeps {
  agentLoop: AgentLoop;
  agentStore: IAgentStore;
  endUserStore: IEndUserStore;
  conversationStore?: IConversationStore;
  heartbeatMs?: number;
  rateLimits?: {
    maxMessagesPerMinute?: number;
    maxConcurrentChats?: number;
    maxConnectionsPerEndUser?: number;
  };
}

export class ClientWebSocketManager {
  private connections = new Map<string, ClientWsConnection>();
  private endUserConnectionCount = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly agentLoop: AgentLoop;
  private readonly agentStore: IAgentStore;
  private readonly endUserStore: IEndUserStore;
  private readonly conversationStore?: IConversationStore;
  private readonly heartbeatMs: number;
  private readonly rateLimits: NonNullable<ClientWsManagerDeps['rateLimits']>;
  private readonly server = new WebSocketServer({ noServer: true });
  private nextId = 1;

  constructor(deps: ClientWsManagerDeps) {
    this.agentLoop = deps.agentLoop;
    this.agentStore = deps.agentStore;
    this.endUserStore = deps.endUserStore;
    this.conversationStore = deps.conversationStore;
    this.heartbeatMs = deps.heartbeatMs ?? 30_000;
    this.rateLimits = deps.rateLimits ?? {};
  }

  async handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer = Buffer.alloc(0),
  ): Promise<void> {
    const urlPath = req.url ?? '/';
    const slugMatch = urlPath.match(/\/v1\/agents\/([^/]+)\/ws/);
    if (!slugMatch) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const slug = slugMatch[1];
    const agentRecord = this.agentStore.getBySlugGlobal
      ? await this.agentStore.getBySlugGlobal(slug)
      : undefined;

    if (!agentRecord || !agentRecord.enabled) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    let endUser: EndUserIdentity;
    try {
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = value;
      }
      const parsedUrl = new URL(urlPath, `http://${req.headers.host ?? 'localhost'}`);
      const query: Record<string, string> = {};
      for (const [key, value] of parsedUrl.searchParams) {
        query[key] = value;
      }

      if (!headers['authorization'] && query.token) {
        headers['authorization'] = `Bearer ${query.token}`;
      }

      endUser = await authenticateEndUser(
        { method: 'GET', url: parsedUrl.pathname, headers, params: {}, query },
        agentRecord.id,
        agentRecord.endUserAuth,
        this.endUserStore,
      );
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (this.rateLimits.maxConnectionsPerEndUser) {
      const currentCount = this.endUserConnectionCount.get(endUser.endUserId) ?? 0;
      if (currentCount >= this.rateLimits.maxConnectionsPerEndUser) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    this.server.handleUpgrade(req, socket, head, (ws) => {
      this.attachConnection(ws, agentRecord.id, agentRecord.teamId, endUser);
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

  closeAll(): void {
    for (const conn of this.connections.values()) {
      for (const controller of conn.activeAbortControllers.values()) {
        controller.abort();
      }
      conn.socket.close();
    }
    this.connections.clear();
    this.endUserConnectionCount.clear();
  }

  private attachConnection(
    ws: WebSocket,
    agentId: string,
    teamId: string,
    endUser: EndUserIdentity,
  ): void {
    const connId = `client-ws-${this.nextId++}`;
    const conn: ClientWsConnection = {
      id: connId,
      socket: ws,
      agentId,
      teamId,
      endUser,
      alive: true,
      messageTimestamps: [],
      activeChats: 0,
      activeAbortControllers: new Map(),
    };
    this.connections.set(connId, conn);
    this.endUserConnectionCount.set(
      endUser.endUserId,
      (this.endUserConnectionCount.get(endUser.endUserId) ?? 0) + 1,
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
      const count = this.endUserConnectionCount.get(endUser.endUserId) ?? 1;
      if (count <= 1) {
        this.endUserConnectionCount.delete(endUser.endUserId);
      } else {
        this.endUserConnectionCount.set(endUser.endUserId, count - 1);
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

  private handleMessage(conn: ClientWsConnection, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      conn.socket.close(1003, 'Binary frames not supported');
      return;
    }

    if (this.rateLimits.maxMessagesPerMinute) {
      const now = Date.now();
      const windowStart = now - 60_000;
      conn.messageTimestamps = conn.messageTimestamps.filter((t) => t > windowStart);
      if (conn.messageTimestamps.length >= this.rateLimits.maxMessagesPerMinute) {
        sendJson(conn.socket, { type: 'error', message: 'Message rate limit exceeded' });
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
      this.handleChat(conn, chatResult.data).catch(() => {
        sendJson(conn.socket, { type: 'error', message: 'Chat processing failed' });
      });
      return;
    }

    sendJson(conn.socket, { type: 'error', message: 'Unknown message type' });
  }

  private async handleChat(
    conn: ClientWsConnection,
    msg: {
      conversationId?: string;
      input: string | { type: string; [key: string]: unknown };
      pluginNamespaces?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    conn.activeChats++;
    const conversationId =
      msg.conversationId ?? `client-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    conn.activeAbortControllers.set(conversationId, abortController);

    try {
      if (this.conversationStore && msg.conversationId) {
        const conv = await this.conversationStore.get(msg.conversationId, conn.endUser.endUserId);
        if (!conv) {
          sendJson(conn.socket, {
            type: 'error',
            message: 'Conversation not found',
            conversationId,
          });
          return;
        }
      }

      const chatInput =
        typeof msg.input === 'string'
          ? { type: 'text' as const, text: msg.input }
          : (msg.input as { type: 'text'; text: string });

      sendJson(conn.socket, { type: 'conversation', conversationId });

      for await (const event of this.agentLoop.run(
        {
          conversationId,
          input: chatInput,
          teamId: conn.teamId,
          userId: conn.endUser.endUserId,
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
