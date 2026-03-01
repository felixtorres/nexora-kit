import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher, type PermissionChecker } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import { TokenBudget } from '@nexora-kit/llm';
import type { ChatEvent, Permission } from './types.js';

function createMockLlm(responses: LlmEvent[][]): LlmProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
    async *chat(_request: LlmRequest): AsyncIterable<LlmEvent> {
      const events = responses[callIndex] ?? [
        { type: 'text' as const, content: 'no more responses' },
        { type: 'done' as const },
      ];
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

async function collectEvents(
  loop: AgentLoop,
  request: Parameters<AgentLoop['run']>[0],
): Promise<ChatEvent[]> {
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
  pluginNamespaces: ['test-plugin'],
};

describe('E2E: Permission enforcement in agent loop', () => {
  it('blocks tool execution when plugin lacks permission', async () => {
    const grants = new Map<string, Set<Permission>>();
    const checker: PermissionChecker = {
      check(ns, perm) {
        return grants.get(ns)?.has(perm) ?? false;
      },
    };

    const dispatcher = new ToolDispatcher();
    dispatcher.setPermissionChecker(checker);
    dispatcher.register(
      { name: 'run-code', description: 'Execute code', parameters: { type: 'object', properties: {} } },
      async () => 'executed',
      { namespace: 'test-plugin', requiredPermissions: ['code:execute'] },
    );

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'run-code', input: {} },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Permission was denied' },
        { type: 'usage', inputTokens: 15, outputTokens: 8 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.isError).toBe(true);
      expect(toolResult.content).toContain('Permission denied');
    }
  });

  it('allows tool execution when plugin has permission', async () => {
    const grants = new Map<string, Set<Permission>>();
    grants.set('test-plugin', new Set(['code:execute']));
    const checker: PermissionChecker = {
      check(ns, perm) {
        return grants.get(ns)?.has(perm) ?? false;
      },
    };

    const dispatcher = new ToolDispatcher();
    dispatcher.setPermissionChecker(checker);
    dispatcher.register(
      { name: 'run-code', description: 'Execute code', parameters: { type: 'object', properties: {} } },
      async () => 'executed successfully',
      { namespace: 'test-plugin', requiredPermissions: ['code:execute'] },
    );

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'run-code', input: {} },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Code ran fine' },
        { type: 'usage', inputTokens: 15, outputTokens: 8 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    const events = await collectEvents(loop, baseRequest);

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.isError).toBeUndefined();
      expect(toolResult.content).toBe('executed successfully');
    }
  });
});

describe('E2E: Token budget enforcement in agent loop', () => {
  it('stops the loop when budget is exceeded', async () => {
    const budget = new TokenBudget({
      defaultInstanceLimit: 1_000_000,
      defaultPluginLimit: 10,
    });

    // Pre-consume the plugin budget entirely
    budget.consume('test-plugin', { inputTokens: 10, outputTokens: 0 });

    const llm = createMockLlm([
      [
        { type: 'text', content: 'This should not appear' },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({
      llm,
      tokenBudget: budget,
      pluginNamespace: 'test-plugin',
    });
    const events = await collectEvents(loop, baseRequest);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('BUDGET_EXCEEDED');
      expect(errorEvent.message).toContain('budget');
    }

    // Should not have produced any text
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(0);
  });

  it('consumes tokens after successful LLM call', async () => {
    const budget = new TokenBudget({
      defaultInstanceLimit: 1_000_000,
      defaultPluginLimit: 500_000,
    });

    const llm = createMockLlm([
      [
        { type: 'text', content: 'Hello!' },
        { type: 'usage', inputTokens: 100, outputTokens: 50 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({
      llm,
      tokenBudget: budget,
      pluginNamespace: 'test-plugin',
    });
    await collectEvents(loop, baseRequest);

    const usage = budget.getInstanceUsage();
    expect(usage.used).toBe(150);
  });

  it('works normally without a token budget (backward compat)', async () => {
    const llm = createMockLlm([
      [
        { type: 'text', content: 'Works fine' },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm });
    const events = await collectEvents(loop, baseRequest);

    expect(events).toContainEqual({ type: 'text', content: 'Works fine' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });
});

describe('E2E: Full pipeline with permissions + budget', () => {
  it('happy path: permission granted, budget available, tool executes', async () => {
    const grants = new Map<string, Set<Permission>>();
    grants.set('test-plugin', new Set(['llm:invoke']));
    const checker: PermissionChecker = {
      check(ns, perm) {
        return grants.get(ns)?.has(perm) ?? false;
      },
    };

    const budget = new TokenBudget({
      defaultInstanceLimit: 1_000_000,
      defaultPluginLimit: 500_000,
    });

    const dispatcher = new ToolDispatcher();
    dispatcher.setPermissionChecker(checker);
    dispatcher.register(
      { name: 'greet', description: 'Greet', parameters: { type: 'object', properties: { name: { type: 'string' } } } },
      async (input) => `Hello, ${input.name}!`,
      { namespace: 'test-plugin', requiredPermissions: ['llm:invoke'] },
    );

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'greet', input: { name: 'World' } },
        { type: 'usage', inputTokens: 20, outputTokens: 10 },
        { type: 'done' },
      ],
      [
        { type: 'text', content: 'Greeting sent' },
        { type: 'usage', inputTokens: 30, outputTokens: 15 },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({
      llm,
      toolDispatcher: dispatcher,
      tokenBudget: budget,
      pluginNamespace: 'test-plugin',
    });
    const events = await collectEvents(loop, baseRequest);

    // Tool result should be successful
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toBe('Hello, World!');
      expect(toolResult.isError).toBeUndefined();
    }

    // Final text response
    expect(events).toContainEqual({ type: 'text', content: 'Greeting sent' });

    // Budget consumed
    const usage = budget.getInstanceUsage();
    expect(usage.used).toBe(75); // 20+10+30+15
  });
});
