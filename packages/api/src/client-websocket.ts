import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentLoop } from '@nexora-kit/core';
import type { IAgentStore, IEndUserStore, IConversationStore } from '@nexora-kit/storage';
import { authenticateEndUser, type EndUserIdentity } from './end-user-auth.js';
import { computeAcceptKey, decodeFrame, encodeFrame, sendJsonFrame } from './ws-utils.js';
import { wsChatMessageSchema, wsPingMessageSchema, wsCancelMessageSchema } from './types.js';

export interface ClientWsConnection {
  id: string;
  socket: Socket;
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
  private nextId = 1;

  constructor(deps: ClientWsManagerDeps) {
    this.agentLoop = deps.agentLoop;
    this.agentStore = deps.agentStore;
    this.endUserStore = deps.endUserStore;
    this.conversationStore = deps.conversationStore;
    this.heartbeatMs = deps.heartbeatMs ?? 30_000;
    this.rateLimits = deps.rateLimits ?? {};
  }

  async handleUpgrade(req: IncomingMessage, socket: Socket): Promise<void> {
    // Extract agent slug from URL: /v1/agents/:slug/ws
    const urlPath = req.url ?? '/';
    const slugMatch = urlPath.match(/\/v1\/agents\/([^/]+)\/ws/);
    if (!slugMatch) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const slug = slugMatch[1];

    // Resolve agent by slug
    const agentRecord = this.agentStore.getBySlugGlobal
      ? await this.agentStore.getBySlugGlobal(slug)
      : undefined;

    if (!agentRecord || !agentRecord.enabled) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Authenticate end user
    let endUser: EndUserIdentity;
    try {
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = value;
      }
      endUser = await authenticateEndUser(
        { method: 'GET', url: urlPath, headers, params: {}, query: {} },
        agentRecord.id,
        agentRecord.endUserAuth,
        this.endUserStore,
      );
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Per end-user connection limit
    if (this.rateLimits.maxConnectionsPerEndUser) {
      const currentCount = this.endUserConnectionCount.get(endUser.endUserId) ?? 0;
      if (currentCount >= this.rateLimits.maxConnectionsPerEndUser) {
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

    const connId = `client-ws-${this.nextId++}`;
    const conn: ClientWsConnection = {
      id: connId,
      socket,
      agentId: agentRecord.id,
      teamId: agentRecord.teamId,
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

    socket.on('data', (data: Buffer) => {
      this.handleData(conn, data);
    });

    const removeConnection = () => {
      this.connections.delete(connId);
      const count = this.endUserConnectionCount.get(endUser.endUserId) ?? 1;
      if (count <= 1) {
        this.endUserConnectionCount.delete(endUser.endUserId);
      } else {
        this.endUserConnectionCount.set(endUser.endUserId, count - 1);
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

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.socket.write(encodeFrame(Buffer.alloc(0), 0x8));
      conn.socket.destroy();
    }
    this.connections.clear();
    this.endUserConnectionCount.clear();
  }

  private handleData(conn: ClientWsConnection, data: Buffer): void {
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
    conn: ClientWsConnection,
    msg: { conversationId?: string; input: string | { type: string; [key: string]: unknown }; pluginNamespaces?: string[]; metadata?: Record<string, unknown> },
  ): Promise<void> {
    conn.activeChats++;
    const conversationId = msg.conversationId ?? `client-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    conn.activeAbortControllers.set(conversationId, abortController);

    try {
      // Verify conversation ownership if conversationStore available and conversationId provided
      if (this.conversationStore && msg.conversationId) {
        const conv = await this.conversationStore.get(msg.conversationId, conn.endUser.endUserId);
        if (!conv) {
          sendJsonFrame(conn.socket, { type: 'error', message: 'Conversation not found', conversationId });
          return;
        }
      }

      const chatInput = typeof msg.input === 'string'
        ? { type: 'text' as const, text: msg.input }
        : msg.input as { type: 'text'; text: string };

      sendJsonFrame(conn.socket, { type: 'conversation', conversationId });

      for await (const event of this.agentLoop.run({
        conversationId,
        input: chatInput,
        teamId: conn.teamId,
        userId: conn.endUser.endUserId,
        pluginNamespaces: msg.pluginNamespaces,
        metadata: msg.metadata,
      }, abortController.signal)) {
        if (conn.socket.destroyed || abortController.signal.aborted) break;
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
