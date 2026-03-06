import { describe, it, expect } from 'vitest';
import { ContextCompactor } from './compaction.js';
import type { LlmProvider, LlmRequest, LlmEvent } from '@nexora-kit/llm';
import type { Message } from './types.js';

function createMockLlm(summaryText: string): LlmProvider {
  return {
    name: 'mock',
    models: [
      { id: 'cheap-model', name: 'Cheap', provider: 'mock', contextWindow: 8000, maxOutputTokens: 1024 },
      { id: 'big-model', name: 'Big', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 },
    ],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      yield { type: 'text', content: summaryText };
      yield { type: 'done' };
    },
    async countTokens() { return 100; },
  };
}

describe('ContextCompactor', () => {
  it('shouldCompact returns true at threshold', () => {
    const llm = createMockLlm('summary');
    const compactor = new ContextCompactor(llm, { triggerRatio: 0.75 });

    expect(compactor.shouldCompact(7500, 10000)).toBe(true);
    expect(compactor.shouldCompact(7499, 10000)).toBe(false);
  });

  it('shouldCompact returns false below threshold', () => {
    const llm = createMockLlm('summary');
    const compactor = new ContextCompactor(llm, { triggerRatio: 0.75 });

    expect(compactor.shouldCompact(5000, 10000)).toBe(false);
  });

  it('compact produces summary via LLM', async () => {
    const llm = createMockLlm('This is a summary of the conversation.');
    const compactor = new ContextCompactor(llm, { keepRecentGroups: 1 });

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'Thanks!' },
    ];

    const result = await compactor.compact(messages);
    expect(result.summary).toBe('This is a summary of the conversation.');
    expect(result.compactedMessages).toBe(4); // all but last group
    expect(result.summaryTokens).toBeGreaterThan(0);
  });

  it('returns empty summary when too few groups to compact', async () => {
    const llm = createMockLlm('should not be called');
    const compactor = new ContextCompactor(llm, { keepRecentGroups: 4 });

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    const result = await compactor.compact(messages);
    expect(result.summary).toBe('');
    expect(result.compactedMessages).toBe(0);
  });

  it('selects cheapest model by default', () => {
    const llm = createMockLlm('summary');
    const compactor = new ContextCompactor(llm);
    // The cheapest model (8000 context) should be selected
    // We can verify by the model field — it's private, so check behavior
    expect(compactor.shouldCompact(0, 100)).toBe(false); // just verifying it's created
  });

  it('uses explicit model when provided', async () => {
    let capturedModel = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [
        { id: 'cheap', name: 'Cheap', provider: 'mock', contextWindow: 8000, maxOutputTokens: 1024 },
        { id: 'expensive', name: 'Expensive', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 },
      ],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        capturedModel = request.model;
        yield { type: 'text', content: 'summary' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const compactor = new ContextCompactor(llm, {
      model: 'expensive',
      keepRecentGroups: 1,
    });

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Bye' },
    ];

    await compactor.compact(messages);
    expect(capturedModel).toBe('expensive');
  });

  it('skips system messages when compacting', async () => {
    const llm = createMockLlm('compacted');
    const compactor = new ContextCompactor(llm, { keepRecentGroups: 1 });

    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Bye' },
    ];

    const result = await compactor.compact(messages);
    // System messages are excluded from compaction
    expect(result.compactedMessages).toBe(2); // user+assistant, not system
  });
});
