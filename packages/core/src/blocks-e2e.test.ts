import { describe, it, expect } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import { InMemoryMessageStore } from './memory.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent, ResponseBlock } from './types.js';

function createMockLlm(responses: LlmEvent[][]): LlmProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      const events = responses[callIndex] ?? [{ type: 'text' as const, content: 'no more responses' }, { type: 'done' as const }];
      callIndex++;
      for (const event of events) yield event;
    },
    async countTokens() { return 100; },
  };
}

async function collectEvents(loop: AgentLoop, request: Parameters<AgentLoop['run']>[0]): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of loop.run(request)) events.push(event);
  return events;
}

const baseRequest = {
  conversationId: 'e2e-conv',
  input: { type: 'text' as const, text: 'go' },
  teamId: 'team-1',
  userId: 'user-1',
};

describe('Blocks E2E pipeline', () => {
  it('skill → blocks → event → storage round-trip', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'info-skill', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Done' }, { type: 'done' }],
    ]);

    const store = new InMemoryMessageStore();
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'info-skill', description: 'Info', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'info text',
        blocks: [
          { type: 'card' as const, title: 'Info Card', body: 'Details here' },
          { type: 'suggested_replies' as const, replies: ['More', 'Done'] },
        ],
      }),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, messageStore: store });
    const events = await collectEvents(loop, baseRequest);

    // Blocks event was yielded
    const blocksEvent = events.find((e) => e.type === 'blocks');
    expect(blocksEvent).toBeDefined();
    if (blocksEvent?.type === 'blocks') {
      expect(blocksEvent.blocks).toHaveLength(2);
    }

    // Blocks stored in messages
    const messages = await store.get('e2e-conv');
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const content = toolMsg!.content as any[];
    const blocksContent = content.find((c: any) => c.type === 'blocks');
    expect(blocksContent).toBeDefined();
    expect(blocksContent.blocks).toHaveLength(2);
  });

  it('action callback → direct dispatch → blocks response', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'checkout', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Here' }, { type: 'done' }],
    ]);

    const store = new InMemoryMessageStore();
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'checkout', description: 'Checkout', parameters: { type: 'object', properties: {} } },
      async (input) => {
        if (input._action) {
          return { content: 'Confirmed!', blocks: [{ type: 'text' as const, content: 'Order placed.' }] };
        }
        return {
          content: '',
          blocks: [{
            type: 'card' as const,
            title: 'Order #42',
            actions: [{ id: 'place-order', label: 'Place Order' }],
          }],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, messageStore: store });

    // Step 1: initial call registers action
    await collectEvents(loop, baseRequest);

    // Step 2: action callback
    const actionEvents = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'place-order', payload: { qty: 1 } },
    });

    expect(actionEvents).toContainEqual({ type: 'text', content: 'Confirmed!' });
    const blocks = actionEvents.find((e) => e.type === 'blocks');
    expect(blocks).toBeDefined();
  });

  it('progress blocks are transient (not stored)', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'long-task', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Done' }, { type: 'done' }],
    ]);

    const store = new InMemoryMessageStore();
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'long-task', description: 'Long', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'complete',
        blocks: [
          { type: 'progress' as const, label: 'Step 1...' },
          { type: 'progress' as const, label: 'Step 2...' },
        ],
      }),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, messageStore: store });
    const events = await collectEvents(loop, baseRequest);

    // Progress yielded in events
    const blocksEvent = events.find((e) => e.type === 'blocks');
    expect(blocksEvent).toBeDefined();
    if (blocksEvent?.type === 'blocks') {
      expect(blocksEvent.blocks).toHaveLength(2);
      expect(blocksEvent.blocks.every((b) => b.type === 'progress')).toBe(true);
    }

    // Progress NOT in storage
    const messages = await store.get(baseRequest.conversationId);
    const toolMsg = messages.find((m) => m.role === 'tool');
    const content = toolMsg!.content as any[];
    const blocksContent = content.find((c: any) => c.type === 'blocks');
    // All blocks were progress, so no blocks content stored
    expect(blocksContent).toBeUndefined();
  });

  it('custom blocks pass through pipeline', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'chart-tool', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Chart ready' }, { type: 'done' }],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'chart-tool', description: 'Chart', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: '',
        blocks: [{ type: 'custom:analytics/chart' as const, data: { labels: ['A', 'B'], values: [10, 20] } } as ResponseBlock],
      }),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const blocksEvent = events.find((e) => e.type === 'blocks');
    expect(blocksEvent).toBeDefined();
    if (blocksEvent?.type === 'blocks') {
      expect(blocksEvent.blocks[0].type).toBe('custom:analytics/chart');
    }
  });

  it('form submission end-to-end', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'survey', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Survey shown' }, { type: 'done' }],
    ]);

    const store = new InMemoryMessageStore();
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'survey', description: 'Survey', parameters: { type: 'object', properties: {} } },
      async (input) => {
        if (input._action) {
          return { content: `Thanks for rating ${input.rating}/5!`, blocks: [] };
        }
        return {
          content: '',
          blocks: [{
            type: 'form' as const,
            id: 'survey-form',
            title: 'Quick Survey',
            fields: [
              { name: 'rating', label: 'Rating', type: 'number' as const, required: true },
              { name: 'comment', label: 'Comment', type: 'textarea' as const },
            ],
            submitLabel: 'Submit',
          }],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, messageStore: store });

    // Show form
    await collectEvents(loop, baseRequest);

    // Submit form
    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'survey-form', payload: { rating: 5, comment: 'Great!' } },
    });

    expect(events).toContainEqual({ type: 'text', content: 'Thanks for rating 5/5!' });
  });
});
