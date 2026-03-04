import { describe, it, expect } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import { InMemoryMessageStore } from './memory.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent, ResponseBlock } from './types.js';

/** Mock LLM provider that returns canned responses */
function createMockLlm(responses: LlmEvent[][]): LlmProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      const events = responses[callIndex] ?? [{ type: 'text' as const, content: 'no more responses' }, { type: 'done' as const }];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
    async countTokens() {
      return 100;
    },
  };
}

async function collectEvents(loop: AgentLoop, request: Parameters<AgentLoop['run']>[0]): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of loop.run(request)) {
    events.push(event);
  }
  return events;
}

describe('AgentLoop', () => {
  const baseRequest = {
    conversationId: 'test-conv',
    input: { type: 'text' as const, text: 'Hello' },
    teamId: 'team-a',
    userId: 'user-1',
  };

  it('streams text response from LLM', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Hi there!' },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm });
    const events = await collectEvents(loop, baseRequest);

    expect(events).toContainEqual({ type: 'text', content: 'Hi there!' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('handles tool calls and loops back to LLM', async () => {
    const llm = createMockLlm([
      // First call: LLM wants to use a tool
      [
        { type: 'tool_call', id: 'tc-1', name: 'add', input: { a: 2, b: 3 } },
        { type: 'usage', inputTokens: 20, outputTokens: 10 },
        { type: 'done' },
      ],
      // Second call: LLM sees tool result and responds
      [
        { type: 'text', content: 'The sum is 5' },
        { type: 'usage', inputTokens: 30, outputTokens: 10 },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'add', description: 'Add', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
      async (input) => String(Number(input.a) + Number(input.b)),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toBeDefined();

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toBe('5');
    }

    expect(events).toContainEqual({ type: 'text', content: 'The sum is 5' });
  });

  it('respects maxTurns limit', async () => {
    // LLM always requests a tool call, never producing text-only response
    const llm = createMockLlm(
      Array.from({ length: 20 }, () => [
        { type: 'tool_call' as const, id: 'tc', name: 'echo', input: {} },
        { type: 'done' as const },
      ]),
    );

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, maxTurns: 3 });
    const events = await collectEvents(loop, baseRequest);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('MAX_TURNS');
    }
  });

  it('aborts a running loop', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Starting...' },
        { type: 'tool_call', id: 'tc', name: 'slow', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Should not reach' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'done';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // Abort after brief delay
    setTimeout(() => loop.abort('test-conv'), 50);

    const events = await collectEvents(loop, baseRequest);
    const hasSecondText = events.some(
      (e) => e.type === 'text' && e.content === 'Should not reach',
    );
    expect(hasSecondText).toBe(false);
  });

  it('dispatches commands directly without LLM', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'Should not be called' }, { type: 'done' }],
    ]);

    const commandDispatcher = {
      isCommand: (input: string) => input.startsWith('/test:'),
      dispatch: async (input: string) => ({
        content: `Command executed: ${input}`,
      }),
    };

    const loop = new AgentLoop({ llm, commandDispatcher });
    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'text', text: '/test:greet --name Felix' },
    });

    expect(events).toContainEqual({ type: 'text', content: 'Command executed: /test:greet --name Felix' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    // Should not contain any LLM text
    expect(events.some((e) => e.type === 'text' && e.content === 'Should not be called')).toBe(false);
  });

  it('falls through to LLM for non-matching / messages', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'LLM response' }, { type: 'done' }],
    ]);

    const commandDispatcher = {
      isCommand: () => false,
      dispatch: async () => ({ content: 'Should not be called' }),
    };

    const loop = new AgentLoop({ llm, commandDispatcher });
    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'text', text: '/unknown-command' },
    });

    expect(events).toContainEqual({ type: 'text', content: 'LLM response' });
  });

  it('yields error event for failed command', async () => {
    const llm = createMockLlm([]);

    const commandDispatcher = {
      isCommand: (input: string) => input.startsWith('/test:'),
      dispatch: async () => ({ content: 'Command failed', isError: true }),
    };

    const loop = new AgentLoop({ llm, commandDispatcher });
    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'text', text: '/test:bad' },
    });

    expect(events).toContainEqual({ type: 'error', message: 'Command failed', code: 'COMMAND_ERROR' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('handles tool dispatch errors gracefully', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'missing-tool', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Tool failed' },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm });
    const events = await collectEvents(loop, baseRequest);

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.isError).toBe(true);
      expect(toolResult.content).toContain('not found');
    }
  });

  it('respects external AbortSignal', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Starting...' },
        { type: 'tool_call', id: 'tc', name: 'slow', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Should not reach' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'done';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const ac = new AbortController();

    setTimeout(() => ac.abort(), 50);

    const events: ChatEvent[] = [];
    for await (const event of loop.run(baseRequest, ac.signal)) {
      events.push(event);
    }
    const hasSecondText = events.some(
      (e) => e.type === 'text' && e.content === 'Should not reach',
    );
    expect(hasSecondText).toBe(false);
  });

  it('yields blocks event when tool returns blocks', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'card-tool', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Done' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'card-tool', description: 'Card', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'card data',
        blocks: [{ type: 'card' as const, title: 'Order #1' }],
      }),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const blocksEvent = events.find((e) => e.type === 'blocks');
    expect(blocksEvent).toBeDefined();
    if (blocksEvent?.type === 'blocks') {
      expect(blocksEvent.blocks).toHaveLength(1);
      expect(blocksEvent.blocks[0].type).toBe('card');
    }
  });

  it('does not yield blocks event when tool returns no blocks', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'plain', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Done' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'plain', description: 'Plain', parameters: { type: 'object', properties: {} } },
      async () => 'just text',
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    expect(events.some((e) => e.type === 'blocks')).toBe(false);
  });

  it('filters ProgressBlock from storage but yields in event', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'progress-tool', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Done' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'progress-tool', description: 'Progress', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'processing',
        blocks: [
          { type: 'progress' as const, label: 'Working...' },
          { type: 'text' as const, content: 'Result ready' },
        ],
      }),
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    // Both blocks yielded as event (including progress)
    const blocksEvent = events.find((e) => e.type === 'blocks');
    expect(blocksEvent).toBeDefined();
    if (blocksEvent?.type === 'blocks') {
      expect(blocksEvent.blocks).toHaveLength(2);
    }
  });

  it('handles multiple tool calls with blocks', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'tool-a', input: {} },
        { type: 'tool_call', id: 'tc-2', name: 'tool-b', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Both done' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'tool-a', description: 'A', parameters: { type: 'object', properties: {} } },
      async () => ({ content: 'a', blocks: [{ type: 'text' as const, content: 'from A' }] }),
    );
    dispatcher.register(
      { name: 'tool-b', description: 'B', parameters: { type: 'object', properties: {} } },
      async () => 'b-text',
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const blocksEvents = events.filter((e) => e.type === 'blocks');
    expect(blocksEvents).toHaveLength(1); // only tool-a has blocks
  });

  it('routes action input directly to tool when mapping exists', async () => {
    // First request: tool returns blocks with actions
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'order-tool', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Here is your order' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    let lastInput: Record<string, unknown> = {};
    dispatcher.register(
      { name: 'order-tool', description: 'Order', parameters: { type: 'object', properties: {} } },
      async (input) => {
        lastInput = input;
        if (input._action) {
          return { content: 'Order confirmed', blocks: [{ type: 'text' as const, content: 'Confirmed!' }] };
        }
        return {
          content: 'Order details',
          blocks: [
            {
              type: 'card' as const,
              title: 'Order #1',
              actions: [{ id: 'confirm-order', label: 'Confirm' }],
            },
          ],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // First: tool call registers action
    await collectEvents(loop, baseRequest);

    // Second: action input routes directly to tool
    const actionEvents = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'confirm-order', payload: { note: 'rush' } },
    });

    expect(lastInput._action).toBe(true);
    expect(lastInput.actionId).toBe('confirm-order');
    expect(lastInput.note).toBe('rush');
    expect(actionEvents).toContainEqual({ type: 'text', content: 'Order confirmed' });
    expect(actionEvents.some((e) => e.type === 'blocks')).toBe(true);
    expect(actionEvents[actionEvents.length - 1]).toEqual({ type: 'done' });
  });

  it('falls through to LLM when no action mapping exists', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'I do not understand that action' },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm });
    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'unknown-action', payload: {} },
    });

    expect(events).toContainEqual({ type: 'text', content: 'I do not understand that action' });
  });

  it('registers actions from action response for chaining', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'wizard', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Step 1' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    let callCount = 0;
    dispatcher.register(
      { name: 'wizard', description: 'Wizard', parameters: { type: 'object', properties: {} } },
      async (input) => {
        callCount++;
        if (input._action && input.actionId === 'step-2') {
          return { content: 'Step 2 done', blocks: [] };
        }
        return {
          content: 'Step 1',
          blocks: [{ type: 'action' as const, actions: [{ id: 'step-2', label: 'Next' }] }],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // First call registers step-2 action
    await collectEvents(loop, baseRequest);
    expect(callCount).toBe(1);

    // Action routes directly
    const events2 = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'step-2', payload: {} },
    });
    expect(callCount).toBe(2);
    expect(events2).toContainEqual({ type: 'text', content: 'Step 2 done' });
  });

  it('form submission routes to tool', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'form-tool', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'form shown' }, { type: 'done' }],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'form-tool', description: 'Form', parameters: { type: 'object', properties: {} } },
      async (input) => {
        if (input._action) {
          return { content: `Received: ${input.name}`, blocks: [] };
        }
        return {
          content: '',
          blocks: [{
            type: 'form' as const,
            id: 'user-form',
            fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
          }],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    await collectEvents(loop, baseRequest);

    const events = await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'user-form', payload: { name: 'Felix' } },
    });

    expect(events).toContainEqual({ type: 'text', content: 'Received: Felix' });
  });

  it('yields cancelled event when aborted mid-stream', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Partial ' },
        // Simulate slow stream — abort will fire during this
        { type: 'text', content: 'response' },
        { type: 'tool_call', id: 'tc', name: 'slow', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Should not reach' }, { type: 'done' }],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'done';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // Abort after tool dispatch starts
    setTimeout(() => loop.abort('test-conv'), 50);

    const events = await collectEvents(loop, baseRequest);

    // Should have cancelled event
    expect(events.some((e) => e.type === 'cancelled')).toBe(true);
    // Should NOT have 'done' event after cancelled
    const cancelledIdx = events.findIndex((e) => e.type === 'cancelled');
    expect(events.slice(cancelledIdx + 1).some((e) => e.type === 'done')).toBe(false);
  });

  it('stores partial text when cancelled', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Partial text here' },
        { type: 'tool_call', id: 'tc', name: 'slow', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Should not reach' }, { type: 'done' }],
    ]);

    const store = new InMemoryMessageStore();
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'done';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, messageStore: store });

    setTimeout(() => loop.abort('test-conv'), 50);
    await collectEvents(loop, baseRequest);

    // Partial text should be stored
    const messages = await store.get('test-conv');
    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThan(0);
    // The partial text should include what was accumulated
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const content = typeof lastAssistant.content === 'string'
      ? lastAssistant.content
      : (lastAssistant.content as any[]).find((c: any) => c.type === 'text')?.text ?? '';
    expect(content).toContain('Partial text here');
  });

  it('rejects concurrent generation on same conversation', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Slow response' },
        { type: 'done' },
      ],
    ]);

    // Override LLM to be slow
    const slowLlm: LlmProvider = {
      ...llm,
      async *chat() {
        await new Promise((r) => setTimeout(r, 200));
        yield { type: 'text' as const, content: 'Slow' };
        yield { type: 'done' as const };
      },
    };

    const loop = new AgentLoop({ llm: slowLlm });

    // Start first generation (don't await)
    const firstGen = collectEvents(loop, baseRequest);

    // Wait a tick so the first run starts
    await new Promise((r) => setTimeout(r, 10));

    // Second generation should be rejected
    const secondEvents = await collectEvents(loop, baseRequest);

    expect(secondEvents).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'CONFLICT' }),
    );
    expect(secondEvents[secondEvents.length - 1]).toEqual({ type: 'done' });

    // Clean up first generation
    loop.abort('test-conv');
    await firstGen;
  });

  it('allows new generation after cancellation', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'First' },
        { type: 'tool_call', id: 'tc', name: 'slow', input: {} },
        { type: 'done' },
      ],
      // Second run
      [
        { type: 'text', content: 'Regenerated response' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'done';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // Abort first run
    setTimeout(() => loop.abort('test-conv'), 50);
    await collectEvents(loop, baseRequest);

    // After abort completes, should be able to start new generation
    const events2 = await collectEvents(loop, baseRequest);
    expect(events2).toContainEqual({ type: 'text', content: 'Regenerated response' });
    expect(events2[events2.length - 1]).toEqual({ type: 'done' });
  });

  it('isActive returns true during generation', async () => {
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat() {
        await new Promise((r) => setTimeout(r, 100));
        yield { type: 'text' as const, content: 'Hi' };
        yield { type: 'done' as const };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({ llm });
    expect(loop.isActive('test-conv')).toBe(false);

    const gen = collectEvents(loop, baseRequest);
    await new Promise((r) => setTimeout(r, 10));
    expect(loop.isActive('test-conv')).toBe(true);

    loop.abort('test-conv');
    await gen;
    expect(loop.isActive('test-conv')).toBe(false);
  });

  it('uses request.systemPrompt override', async () => {
    let capturedMessages: unknown[] = [];
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        capturedMessages = request.messages;
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({ llm, systemPrompt: 'Default prompt' });
    await collectEvents(loop, {
      ...baseRequest,
      conversationId: 'prompt-override',
      systemPrompt: 'Custom per-conversation prompt',
    });

    // System prompt in assembled context should be the override
    const systemMsg = (capturedMessages as any[]).find((m) => m.content === 'Custom per-conversation prompt');
    expect(systemMsg).toBeDefined();
  });

  it('uses request.model override for LLM calls', async () => {
    let capturedModel = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'default-model', name: 'Default', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        capturedModel = request.model;
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({ llm, model: 'default-model' });
    await collectEvents(loop, {
      ...baseRequest,
      conversationId: 'model-override',
      model: 'custom-model',
    });

    expect(capturedModel).toBe('custom-model');
  });

  it('injects skill index into system prompt when skillIndexProvider is set', async () => {
    let capturedSystemPrompt = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        // Capture the system prompt from the first message
        if (request.messages.length > 0 && request.messages[0].role === 'system') {
          capturedSystemPrompt = request.messages[0].content as string;
        }
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const skillIndexProvider = {
      buildIndex(namespace: string): string {
        if (namespace === 'kyvos') {
          return '## Available Skills (kyvos)\n- **sql-queries** — Generate SQL';
        }
        return '';
      },
    };

    const loop = new AgentLoop({ llm, skillIndexProvider });
    await collectEvents(loop, {
      ...baseRequest,
      conversationId: 'skill-index-test',
      pluginNamespaces: ['kyvos'],
    });

    expect(capturedSystemPrompt).toContain('## Available Skills (kyvos)');
    expect(capturedSystemPrompt).toContain('**sql-queries**');
  });

  it('does not inject skill index when no plugin namespaces', async () => {
    let capturedSystemPrompt = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        if (request.messages.length > 0 && request.messages[0].role === 'system') {
          capturedSystemPrompt = request.messages[0].content as string;
        }
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const skillIndexProvider = {
      buildIndex(): string { return 'should not appear'; },
    };

    const loop = new AgentLoop({ llm, skillIndexProvider });
    await collectEvents(loop, {
      ...baseRequest,
      conversationId: 'no-ns-test',
    });

    expect(capturedSystemPrompt).not.toContain('should not appear');
  });

  it('concatenates skill indexes from multiple namespaces', async () => {
    let capturedSystemPrompt = '';
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        if (request.messages.length > 0 && request.messages[0].role === 'system') {
          capturedSystemPrompt = request.messages[0].content as string;
        }
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const skillIndexProvider = {
      buildIndex(namespace: string): string {
        if (namespace === 'kyvos') return '## Available Skills (kyvos)\n- **sql** — SQL';
        if (namespace === 'hello') return '## Available Skills (hello)\n- **greet** — Greet';
        return '';
      },
    };

    const loop = new AgentLoop({ llm, skillIndexProvider });
    await collectEvents(loop, {
      ...baseRequest,
      conversationId: 'multi-ns-test',
      pluginNamespaces: ['kyvos', 'hello'],
    });

    expect(capturedSystemPrompt).toContain('Available Skills (kyvos)');
    expect(capturedSystemPrompt).toContain('Available Skills (hello)');
  });
});
