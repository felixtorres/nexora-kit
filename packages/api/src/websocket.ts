import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AgentLoop, ChatEvent } from '@nexora-kit/core';
import type { AuthProvider, AuthIdentity } from './types.js';
import { wsChatMessageSchema, wsPingMessageSchema } from './types.js';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB9B6FF85B5';

export interface WsConnection {
  id: string;
  socket: Socket;
  auth: AuthIdentity;
  alive: boolean;
}

export class WebSocketManager {
  private connections = new Map<string, WsConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly agentLoop: AgentLoop;
  private readonly auth: AuthProvider;
  private readonly heartbeatMs: number;
  private nextId = 1;

  constructor(options: {
    agentLoop: AgentLoop;
    auth: AuthProvider;
    heartbeatMs?: number;
  }) {
    this.agentLoop = options.agentLoop;
    this.auth = options.auth;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
  }

  async handleUpgrade(req: IncomingMessage, socket: Socket): Promise<void> {
    // Authenticate
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value;
    }
    const identity = await this.auth.authenticate({
      method: 'GET',
      url: req.url ?? '/',
      headers,
      params: {},
      query: {},
    });

    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
    );

    const connId = `ws-${this.nextId++}`;
    const conn: WsConnection = { id: connId, socket, auth: identity, alive: true };
    this.connections.set(connId, conn);

    socket.on('data', (data: Buffer) => {
      this.handleData(conn, data);
    });

    socket.on('close', () => {
      this.connections.delete(connId);
    });

    socket.on('error', () => {
      this.connections.delete(connId);
    });
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
        this.sendFrame(conn.socket, Buffer.alloc(0), 0x9); // Ping
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
      // Send close frame
      this.sendFrame(conn.socket, Buffer.alloc(0), 0x8);
      conn.socket.destroy();
    }
    this.connections.clear();
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
      this.sendFrame(conn.socket, Buffer.alloc(0), 0x8);
      conn.socket.destroy();
      this.connections.delete(conn.id);
      return;
    }

    // Text frame
    if (frame.opcode !== 0x1) return;

    let message: unknown;
    try {
      message = JSON.parse(frame.payload.toString());
    } catch {
      this.sendJson(conn.socket, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    // Ping message
    const pingResult = wsPingMessageSchema.safeParse(message);
    if (pingResult.success) {
      this.sendJson(conn.socket, { type: 'pong' });
      return;
    }

    // Chat message
    const chatResult = wsChatMessageSchema.safeParse(message);
    if (chatResult.success) {
      this.handleChat(conn, chatResult.data).catch(() => {
        this.sendJson(conn.socket, { type: 'error', message: 'Chat processing failed' });
      });
      return;
    }

    this.sendJson(conn.socket, { type: 'error', message: 'Unknown message type' });
  }

  private async handleChat(
    conn: WsConnection,
    msg: { sessionId?: string; message: string; pluginNamespaces?: string[]; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const sessionId = msg.sessionId ?? `ws-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.sendJson(conn.socket, { type: 'session', sessionId });

    for await (const event of this.agentLoop.run({
      sessionId,
      message: msg.message,
      teamId: conn.auth.teamId,
      userId: conn.auth.userId,
      pluginNamespaces: msg.pluginNamespaces,
      metadata: msg.metadata,
    })) {
      if (conn.socket.destroyed) break;
      this.sendJson(conn.socket, event);
    }
  }

  private sendJson(socket: Socket, data: unknown): void {
    if (socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify(data));
    this.sendFrame(socket, payload, 0x1); // Text frame
  }

  private sendFrame(socket: Socket, payload: Buffer, opcode: number): void {
    if (socket.destroyed) return;

    const len = payload.length;
    let header: Buffer;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode; // FIN + opcode
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    socket.write(Buffer.concat([header, payload]));
  }
}

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
}

function decodeFrame(data: Buffer): DecodedFrame | null {
  if (data.length < 2) return null;

  const opcode = data[0] & 0x0F;
  const masked = (data[1] & 0x80) !== 0;
  let payloadLength = data[1] & 0x7F;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    payloadLength = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (data.length < offset + 4) return null;
    maskKey = data.subarray(offset, offset + 4);
    offset += 4;
  }

  if (data.length < offset + payloadLength) return null;

  const payload = data.subarray(offset, offset + payloadLength);

  if (maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { opcode, payload };
}

/** Check if an HTTP request is a WebSocket upgrade */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers['upgrade'];
  return upgrade?.toLowerCase() === 'websocket';
}
