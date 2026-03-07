import WebSocket from 'ws';
import type { ChatEvent } from '@nexora-kit/core';
import type { EvalClient, WsEventStream, TimestampedEvent } from './types.js';

interface ClientOptions {
  baseUrl: string;
  adminApiKey: string;
  userApiKey: string;
}

export function createEvalClient(options: ClientOptions): EvalClient {
  const { baseUrl, adminApiKey, userApiKey } = options;
  const activeSockets: InstanceType<typeof WebSocket>[] = [];

  async function adminFetch(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${baseUrl}/v1${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminApiKey}`,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Admin API ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  async function userFetch(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${baseUrl}/v1${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userApiKey}`,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`User API ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  return {
    baseUrl,
    adminApiKey,
    userApiKey,

    async createBot(body) {
      return (await adminFetch('/admin/bots', {
        method: 'POST',
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
    },

    async createAgent(body) {
      return (await adminFetch('/admin/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
    },

    async replaceBindings(agentId, botIds) {
      await adminFetch(`/admin/agents/${agentId}/bindings`, {
        method: 'PUT',
        body: JSON.stringify({ botIds }),
      });
    },

    async enablePlugin(namespace) {
      await adminFetch(`/admin/plugins/${namespace}/enable`, { method: 'POST' });
    },

    async disablePlugin(namespace) {
      await adminFetch(`/admin/plugins/${namespace}/disable`, { method: 'POST' });
    },

    async createConversation(body) {
      return (await userFetch('/conversations', {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      })) as { id: string };
    },

    async getMessages(conversationId) {
      return (await userFetch(`/conversations/${conversationId}/messages`)) as Array<{
        role: string;
        content: unknown;
      }>;
    },

    async sendMessage(conversationId, text, timeoutMs = 120_000): Promise<WsEventStream> {
      const wsUrl = baseUrl.replace(/^http/, 'ws') + '/v1/ws';
      return new Promise<WsEventStream>((resolve, reject) => {
        const events: ChatEvent[] = [];
        const timestampedEvents: TimestampedEvent[] = [];
        let responseText = '';
        let settled = false;
        const start = Date.now();

        const ws = new WebSocket(wsUrl, {
          headers: { Authorization: `Bearer ${userApiKey}` },
        });
        activeSockets.push(ws);

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            resolve({ events, timestampedEvents, responseText, wallClockMs: Date.now() - start });
          }
        }, timeoutMs);

        function settle(wallClockMs: number) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ events, timestampedEvents, responseText, wallClockMs });
        }

        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              type: 'chat',
              conversationId,
              input: text,
            }),
          );
        });

        ws.on('message', (data: Buffer) => {
          try {
            const frame = JSON.parse(data.toString()) as {
              type: string;
              conversationId?: string;
              payload?: ChatEvent;
            };

            // Skip non-event frames (conversation, pong)
            if (frame.type === 'conversation' || frame.type === 'pong') return;

            // Extract the actual ChatEvent from the payload
            const event = frame.payload ?? (frame as unknown as ChatEvent);
            const receivedAt = Date.now();
            events.push(event);
            timestampedEvents.push({ event, receivedAt });

            if (event.type === 'text') {
              responseText += (event as { type: 'text'; content: string }).content;
            }

            if (frame.type === 'done' || frame.type === 'error' || frame.type === 'cancelled') {
              settle(Date.now() - start);
            }
          } catch {
            // ignore non-JSON frames
          }
        });

        ws.on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${err.message}`));
          }
        });

        ws.on('unexpected-response', (_req: unknown, res: { statusCode?: number }) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`WebSocket upgrade rejected (HTTP ${res.statusCode ?? 'unknown'})`));
          }
        });

        ws.on('close', () => {
          settle(Date.now() - start);
        });
      });
    },

    close() {
      for (const ws of activeSockets) {
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
      activeSockets.length = 0;
    },
  };
}
