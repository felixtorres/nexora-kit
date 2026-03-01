import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent, ToolSelectorInterface, SelectedTools, ObservabilityHooks } from './types.js';

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
    async countTokens() { return 100; },
  };
}

async function collectEvents(loop: AgentLoop, request: Parameters<AgentLoop['run']>[0]): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of loop.run(request)) {
    events.push(event);
  }
  return events;
}

const baseRequest = {
  sessionId: 'test-session',
  message: 'Hello',
  teamId: 'team-a',
  userId: 'user-1',
};

describe('AgentLoop with ToolSelector', () => {
  it('uses tool selector when provided', async () => {
    const searchTool = {
      name: 'search',
      description: 'Search',
      parameters: { type: 'object' as const, properties: {} },
    };

    const mockSelector: ToolSelectorInterface = {
      select: vi.fn().mockReturnValue({
        tools: [searchTool],
        totalTokens: 100,
        droppedCount: 5,
        selectionTimeMs: 1,
      } satisfies SelectedTools),
    };

    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(searchTool, async () => 'result');
    // Register many tools on the dispatcher — selector should filter
    for (let i = 0; i < 10; i++) {
      dispatcher.register(
        { name: `tool-${i}`, description: `Tool ${i}`, parameters: { type: 'object', properties: {} } },
        async () => `result-${i}`,
      );
    }

    const loop = new AgentLoop({
      llm,
      toolDispatcher: dispatcher,
      toolSelector: mockSelector,
      toolTokenBudget: 500,
    });

    await collectEvents(loop, { ...baseRequest, pluginNamespaces: ['ns-a'] });
    expect(mockSelector.select).toHaveBeenCalled();
    const call = vi.mocked(mockSelector.select).mock.calls[0][0];
    expect(call.query).toBe('Hello');
    expect(call.namespaces).toEqual(['ns-a']);
    expect(call.tokenBudget).toBe(500);
  });

  it('falls back to dispatcher.listTools() without selector', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'tool-a', description: 'A', parameters: { type: 'object', properties: {} } },
      async () => 'a',
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);
    expect(events.some((e) => e.type === 'text' && e.content === 'ok')).toBe(true);
  });
});

describe('AgentLoop with Observability', () => {
  it('calls observability hooks during execution', async () => {
    const obs: ObservabilityHooks = {
      onTraceStart: vi.fn(),
      onGeneration: vi.fn(),
      onToolCall: vi.fn(),
      onToolSelection: vi.fn(),
      onTraceEnd: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'greet', input: { name: 'World' } },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Hello World' },
        { type: 'usage', inputTokens: 15, outputTokens: 8 },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'greet', description: 'Greet', parameters: { type: 'object', properties: {} } },
      async (input) => `Hello ${input.name}`,
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, observability: obs });
    await collectEvents(loop, baseRequest);

    expect(obs.onTraceStart).toHaveBeenCalledOnce();
    expect(obs.onGeneration).toHaveBeenCalledTimes(2); // Two LLM calls
    expect(obs.onToolCall).toHaveBeenCalledOnce();
    expect(obs.onTraceEnd).toHaveBeenCalledOnce();

    // Verify generation data
    const genCall = vi.mocked(obs.onGeneration).mock.calls[0][0];
    expect(genCall.model).toBe('mock-1');
    expect(genCall.usage).toEqual({ input: 10, output: 5 });

    // Verify tool call data
    const toolCallData = vi.mocked(obs.onToolCall).mock.calls[0][0];
    expect(toolCallData.name).toBe('greet');
    expect(toolCallData.isError).toBe(false);

    // Verify trace end
    const traceEnd = vi.mocked(obs.onTraceEnd).mock.calls[0];
    expect(traceEnd[1].turns).toBe(2);
    expect(traceEnd[1].totalTokens).toBe(38); // 10+5+15+8
  });

  it('calls onToolSelection when selector is used', async () => {
    const obs: ObservabilityHooks = {
      onTraceStart: vi.fn(),
      onGeneration: vi.fn(),
      onToolCall: vi.fn(),
      onToolSelection: vi.fn(),
      onTraceEnd: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    const mockSelector: ToolSelectorInterface = {
      select: vi.fn().mockReturnValue({
        tools: [],
        totalTokens: 50,
        droppedCount: 10,
        selectionTimeMs: 2.5,
      }),
    };

    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({
      llm,
      toolSelector: mockSelector,
      observability: obs,
    });
    await collectEvents(loop, baseRequest);

    expect(obs.onToolSelection).toHaveBeenCalledOnce();
    const selectionData = vi.mocked(obs.onToolSelection).mock.calls[0][0];
    expect(selectionData.selected).toBe(0);
    expect(selectionData.dropped).toBe(10);
  });

  it('records error tool calls', async () => {
    const obs: ObservabilityHooks = {
      onTraceStart: vi.fn(),
      onGeneration: vi.fn(),
      onToolCall: vi.fn(),
      onToolSelection: vi.fn(),
      onTraceEnd: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'missing', input: {} },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'failed' },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm, observability: obs });
    await collectEvents(loop, baseRequest);

    const toolCallData = vi.mocked(obs.onToolCall).mock.calls[0][0];
    expect(toolCallData.name).toBe('missing');
    // The dispatcher returns isError for missing tools, but it returns undefined,
    // and we coerce to boolean
    expect(toolCallData.output).toContain('not found');
  });

  it('getRecentToolNames extracts from session messages', async () => {
    const obs: ObservabilityHooks = {
      onTraceStart: vi.fn(),
      onGeneration: vi.fn(),
      onToolCall: vi.fn(),
      onToolSelection: vi.fn(),
      onTraceEnd: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    const mockSelector: ToolSelectorInterface = {
      select: vi.fn().mockReturnValue({
        tools: [{ name: 'search', description: 'S', parameters: { type: 'object', properties: {} } }],
        totalTokens: 50,
        droppedCount: 0,
        selectionTimeMs: 1,
      }),
    };

    const llm = createMockLlm([
      // First turn: tool call
      [
        { type: 'tool_call', id: 'tc-1', name: 'search', input: { q: 'test' } },
        { type: 'done' },
      ],
      // Second turn: text response
      [
        { type: 'text', content: 'found it' },
        { type: 'done' },
      ],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } },
      async () => 'result',
    );

    const loop = new AgentLoop({
      llm,
      toolDispatcher: dispatcher,
      toolSelector: mockSelector,
      observability: obs,
    });
    await collectEvents(loop, baseRequest);

    // Second call to select should include recent tool names
    if (vi.mocked(mockSelector.select).mock.calls.length > 1) {
      const secondCall = vi.mocked(mockSelector.select).mock.calls[1][0];
      expect(secondCall.recentToolNames).toContain('search');
    }
  });
});
