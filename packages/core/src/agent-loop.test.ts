import { describe, it, expect } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent } from './types.js';

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
});
