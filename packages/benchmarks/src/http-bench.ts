import { Gateway, ApiKeyAuth } from '@nexora-kit/api';
import type { BenchResult } from './report.js';

function makeMockAgentLoop() {
  return {
    run: async function* () {
      yield { type: 'text', content: 'Hello!' };
      yield { type: 'done' };
    },
    abort() {},
    toolDispatcher: { listTools: () => [] },
  } as any;
}

function makeMockConversationStore() {
  const store = new Map<string, any>();
  let nextId = 1;
  return {
    create(input: any) {
      const id = `conv-${nextId++}`;
      const now = new Date().toISOString();
      const record = { id, teamId: input.teamId, userId: input.userId, title: input.title ?? null, messageCount: 0, lastMessageAt: null, metadata: {}, createdAt: now, updatedAt: now, deletedAt: null, pluginNamespaces: [] };
      store.set(id, record);
      return record;
    },
    get(id: string, userId: string) { const r = store.get(id); return r && r.userId === userId ? r : undefined; },
    list() { return { items: [...store.values()], nextCursor: null }; },
    update(id: string, userId: string, patch: any) { const r = store.get(id); if (!r || r.userId !== userId) return undefined; Object.assign(r, patch); return r; },
    softDelete(id: string, userId: string) { const r = store.get(id); if (!r || r.userId !== userId) return false; store.delete(id); return true; },
    updateMessageStats(id: string, count: number, lastMessageAt: string) { const r = store.get(id); if (r) { r.messageCount = count; r.lastMessageAt = lastMessageAt; } },
  } as any;
}

export async function runHttpBench(iterations: number = 100): Promise<BenchResult[]> {
  const gateway = new Gateway({
    port: 0,
    agentLoop: makeMockAgentLoop(),
    conversationStore: makeMockConversationStore(),
    auth: new ApiKeyAuth({
      'bench-key': { userId: 'bench', teamId: 'bench', role: 'user' },
    }),
  });

  await gateway.start();
  const addr = gateway.getAddress()!;
  const base = `http://${addr.host}:${addr.port}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer bench-key',
  };

  const healthLatencies: number[] = [];
  const createConvLatencies: number[] = [];
  const sendMsgLatencies: number[] = [];
  const chatLatencies: number[] = [];

  // Warm up
  for (let i = 0; i < 5; i++) {
    await fetch(`${base}/v1/health`);
  }

  // Health endpoint
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fetch(`${base}/v1/health`);
    healthLatencies.push(performance.now() - start);
  }

  // Create conversation + send message flow
  for (let i = 0; i < iterations; i++) {
    // Create conversation
    let start = performance.now();
    const createRes = await fetch(`${base}/v1/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: `Bench ${i}` }),
    });
    createConvLatencies.push(performance.now() - start);

    const conv = await createRes.json() as { id: string };

    // Send message
    start = performance.now();
    await fetch(`${base}/v1/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: 'Hello' }),
    });
    sendMsgLatencies.push(performance.now() - start);
  }

  // Legacy chat endpoint
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: 'Hello' }),
    });
    chatLatencies.push(performance.now() - start);
  }

  await gateway.stop();

  return [
    { name: 'GET /v1/health', samples: healthLatencies },
    { name: 'POST /v1/conversations', samples: createConvLatencies },
    { name: 'POST /v1/conversations/:id/messages', samples: sendMsgLatencies },
    { name: 'POST /v1/chat (legacy)', samples: chatLatencies },
  ];
}
