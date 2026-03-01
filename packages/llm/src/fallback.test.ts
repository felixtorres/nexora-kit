import { describe, it, expect } from 'vitest';
import { FallbackChain } from './fallback.js';
import type { LlmProvider } from './provider.js';
import type { LlmEvent, LlmRequest } from './types.js';

function mockProvider(name: string, shouldFail = false): LlmProvider {
  return {
    name,
    models: [{ id: 'model-1', name: 'Model', provider: name, contextWindow: 100000, maxOutputTokens: 4096 }],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      if (shouldFail) throw new Error(`${name} failed`);
      yield { type: 'text', content: `from ${name}` };
      yield { type: 'done' };
    },
    async countTokens() {
      return 0;
    },
  };
}

describe('FallbackChain', () => {
  it('uses first provider on success', async () => {
    const chain = new FallbackChain({
      providers: [mockProvider('primary'), mockProvider('backup')],
    });

    const events: LlmEvent[] = [];
    for await (const event of chain.chat({ model: 'model-1', messages: [], stream: true })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'text', content: 'from primary' });
  });

  it('falls back to second provider on failure', async () => {
    const chain = new FallbackChain({
      providers: [mockProvider('primary', true), mockProvider('backup')],
      maxRetries: 0,
    });

    const events: LlmEvent[] = [];
    for await (const event of chain.chat({ model: 'model-1', messages: [], stream: true })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'text', content: 'from backup' });
  });

  it('throws AggregateError when all providers fail', async () => {
    const chain = new FallbackChain({
      providers: [mockProvider('a', true), mockProvider('b', true)],
      maxRetries: 0,
    });

    await expect(async () => {
      for await (const _event of chain.chat({ model: 'model-1', messages: [], stream: true })) {
        // consume
      }
    }).rejects.toThrow('All providers failed');
  });

  it('requires at least one provider', () => {
    expect(() => new FallbackChain({ providers: [] })).toThrow('at least one provider');
  });
});
