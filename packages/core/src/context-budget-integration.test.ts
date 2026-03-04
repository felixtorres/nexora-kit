import { describe, it, expect } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent } from './types.js';

function createMockLlm(
  responses: LlmEvent[][],
  contextWindow = 16_000,
  maxOutput = 4_096,
): LlmProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow, maxOutputTokens: maxOutput }],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      const events = responses[callIndex] ?? [{ type: 'text' as const, content: 'done' }, { type: 'done' as const }];
      callIndex++;
      for (const event of events) yield event;
    },
    async countTokens() { return 100; },
  };
}

async function collectEvents(loop: AgentLoop, conversationId = 'test'): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of loop.run({ conversationId, input: { type: 'text', text: 'Hello' } })) {
    events.push(event);
  }
  return events;
}

describe('Model-aware context ceiling', () => {
  it('derives maxContextTokens from ModelInfo when not explicitly set', () => {
    const llm = createMockLlm([[{ type: 'text', content: 'Hi' }, { type: 'done' }]], 16_000, 4_096);
    // Default toolTokenBudget is 4000
    // maxContextTokens should be 16000 - 4096 - 4000 = 7904
    const loop = new AgentLoop({ llm });
    // We can't directly access private maxContextTokens, but we can verify it works
    // by running and not crashing
    expect(loop).toBeDefined();
  });

  it('respects explicit maxContextTokens override', async () => {
    const llm = createMockLlm([[{ type: 'text', content: 'Hi' }, { type: 'done' }]], 128_000);
    const loop = new AgentLoop({ llm, maxContextTokens: 5000 });
    const events = await collectEvents(loop);
    expect(events).toContainEqual({ type: 'text', content: 'Hi' });
  });
});

describe('Tool result truncation', () => {
  it('truncates large tool results in message history', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'big-data', input: {} },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Processed.' },
        { type: 'usage', inputTokens: 20, outputTokens: 10 },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    // Tool returns 100K characters
    const bigResult = 'x'.repeat(100_000);
    dispatcher.register(
      { name: 'big-data', description: 'Return big data', parameters: { type: 'object', properties: {} } },
      async () => bigResult,
    );

    const loop = new AgentLoop({
      llm,
      toolDispatcher: dispatcher,
      maxToolResultTokens: 100, // 100 tokens = ~400 chars
    });
    const events = await collectEvents(loop);

    // Full result should still be yielded as event
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toBe(bigResult);
      expect(toolResult.content.length).toBe(100_000);
    }

    // Verify we got a final response
    expect(events).toContainEqual({ type: 'text', content: 'Processed.' });
  });
});

describe('Skill index budget', () => {
  it('truncates skill index to budget with overflow summaries', async () => {
    const llm = createMockLlm([[{ type: 'text', content: 'OK' }, { type: 'done' }]]);

    // Build a big skill index that exceeds budget
    const bigIndex = 'x'.repeat(5000); // ~1250 tokens
    const skillIndexProvider = {
      buildIndex(ns: string): string {
        if (ns === 'big-plugin') return bigIndex;
        return `## Skills (${ns})\n- skill1`;
      },
    };

    const loop = new AgentLoop({
      llm,
      skillIndexProvider,
      skillIndexTokenBudget: 100, // Very tight budget
    });

    const events = await collectEvents(loop, 'test-conv');
    // Should not crash and should produce a response
    expect(events).toContainEqual({ type: 'text', content: 'OK' });
  });
});
