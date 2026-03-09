import { describe, it, expect, vi } from 'vitest';

vi.mock('./server.js', () => ({
  startEvalServer: vi.fn(async () => ({
    baseUrl: 'http://127.0.0.1:9999',
    adminApiKey: 'admin-key',
    userApiKey: 'user-key',
    stop: async () => {},
  })),
}));

const mockClient = {
  baseUrl: 'http://127.0.0.1:9999',
  adminApiKey: 'admin-key',
  userApiKey: 'user-key',
  createBot: vi.fn(),
  createAgent: vi.fn(),
  replaceBindings: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  createConversation: vi.fn(async () => ({ id: 'conv-1' })),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  close: vi.fn(),
};

vi.mock('./client.js', () => ({
  createEvalClient: vi.fn(() => mockClient),
}));

import { runEval } from './runner.js';

describe('runEval YAML compatibility', () => {
  it('loads YAML messages.content and validators map, failing websocket errors', async () => {
    mockClient.createConversation.mockResolvedValue({ id: 'conv-1' });
    mockClient.sendMessage.mockResolvedValue({
      events: [{ type: 'error', message: 'Unknown message type' }],
      timestampedEvents: [
        { event: { type: 'error', message: 'Unknown message type' }, receivedAt: Date.now() },
      ],
      responseText: '',
      wallClockMs: 5,
    });

    const run = await runEval({
      target: { type: 'config', configPath: '/unused' },
      scenarios: ['/Users/FTorresSa/javascript/nexora-kit/kyvos-bot/evals/data-agent.yaml'],
      repeat: 1,
      concurrency: 1,
      baselineDir: './eval-baselines',
      regression: {
        maxLatencyIncrease: 0.25,
        maxPassRateDecrease: 0.05,
        maxTokenIncrease: 0.15,
      },
      output: 'json',
      updateBaseline: false,
      ci: false,
    });

    const firstCase = run.scenarios[0].cases[0];
    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      'conv-1',
      'Show me the schema for the orders table — what columns does it have, what types, and how does it relate to other tables?',
    );
    expect(firstCase.validations.length).toBeGreaterThan(0);
    expect(firstCase.passed).toBe(false);
    expect(firstCase.error).toContain('Unknown message type');
  });

  it('normalizes inline regex flags from YAML patterns', async () => {
    mockClient.createConversation.mockResolvedValue({ id: 'conv-1' });
    mockClient.sendMessage.mockResolvedValue({
      events: [
        { type: 'text', content: 'The schema includes table and column details.' },
        { type: 'done' },
      ],
      timestampedEvents: [
        {
          event: { type: 'text', content: 'The schema includes table and column details.' },
          receivedAt: Date.now(),
        },
        { event: { type: 'done' }, receivedAt: Date.now() },
      ],
      responseText: 'The schema includes table and column details.',
      wallClockMs: 5,
    });

    const run = await runEval({
      target: { type: 'config', configPath: '/unused' },
      scenarios: ['/Users/FTorresSa/javascript/nexora-kit/kyvos-bot/evals/data-agent.yaml'],
      repeat: 1,
      concurrency: 1,
      baselineDir: './eval-baselines',
      regression: {
        maxLatencyIncrease: 0.25,
        maxPassRateDecrease: 0.05,
        maxTokenIncrease: 0.15,
      },
      output: 'json',
      updateBaseline: false,
      ci: false,
    });

    const firstCase = run.scenarios[0].cases[0];
    expect(
      firstCase.validations.some((validation) =>
        validation.validator.includes('/(column|table|relationship|foreign.?key|schema)/i'),
      ),
    ).toBe(true);
  });
});
