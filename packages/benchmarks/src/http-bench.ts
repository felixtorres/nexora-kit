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

export async function runHttpBench(iterations: number = 100): Promise<BenchResult[]> {
  const gateway = new Gateway({
    port: 0,
    agentLoop: makeMockAgentLoop(),
    auth: new ApiKeyAuth({
      'bench-key': { userId: 'bench', teamId: 'bench', role: 'user' },
    }),
  });

  await gateway.start();
  const addr = gateway.getAddress()!;
  const base = `http://${addr.host}:${addr.port}`;

  const healthLatencies: number[] = [];
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

  // Chat endpoint
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer bench-key',
      },
      body: JSON.stringify({ message: 'Hello' }),
    });
    chatLatencies.push(performance.now() - start);
  }

  await gateway.stop();

  return [
    { name: 'GET /v1/health', samples: healthLatencies },
    { name: 'POST /v1/chat', samples: chatLatencies },
  ];
}
