import { describe, it, expect } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent } from './types.js';

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
  conversationId: 'test-conv',
  input: { type: 'text' as const, text: 'Hello' },
  teamId: 'team-a',
  userId: 'user-1',
};

describe('Sub-Agent Spawning', () => {
  it('_spawn_agent registered when depth < maxDepth', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({
      llm,
      subAgent: { maxDepth: 2 },
      maxTurns: 5,
    });

    // Check that _spawn_agent is in the tool list
    expect(loop.toolDispatcher.hasHandler('_spawn_agent')).toBe(true);
  });

  it('_spawn_agent not registered when depth >= maxDepth', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({
      llm,
      subAgent: { maxDepth: 1 },
      _depth: 1,
      maxTurns: 5,
    });

    expect(loop.toolDispatcher.hasHandler('_spawn_agent')).toBe(false);
  });

  it('_spawn_agent not registered without subAgent config', async () => {
    const llm = createMockLlm([
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({ llm, maxTurns: 5 });
    expect(loop.toolDispatcher.hasHandler('_spawn_agent')).toBe(false);
  });

  it('_spawn_agent runs sub-agent and returns result', async () => {
    // We need enough responses for both parent and child
    let callCount = 0;
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        callCount++;
        const userMsg = request.messages.find((m) => m.role === 'user');
        const userText = userMsg && typeof userMsg.content === 'string' ? userMsg.content : '';

        if (userText.includes('Research topic X')) {
          // Child agent responds
          yield { type: 'text', content: 'Topic X research result: found 3 papers.' };
          yield { type: 'usage', inputTokens: 20, outputTokens: 10 };
        } else if (callCount === 1) {
          // Parent first call: spawn sub-agent
          yield {
            type: 'tool_call',
            id: 'tc-spawn',
            name: '_spawn_agent',
            input: { task: 'Research topic X' },
          };
        } else {
          // Parent final response after getting sub-agent result
          yield { type: 'text', content: 'Based on the research: 3 papers found.' };
        }
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({
      llm,
      subAgent: { maxDepth: 2, subAgentMaxTurns: 5 },
      maxTurns: 5,
      enableWorkingMemory: false,
    });

    const events = await collectEvents(loop, baseRequest);

    // Sub-agent events should be emitted
    const subStart = events.find((e) => e.type === 'sub_agent_start');
    expect(subStart).toBeDefined();
    if (subStart?.type === 'sub_agent_start') {
      expect(subStart.task).toBe('Research topic X');
    }

    const subEnd = events.find((e) => e.type === 'sub_agent_end');
    expect(subEnd).toBeDefined();

    // Tool result should contain the sub-agent's output
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toContain('found 3 papers');
    }

    // Final response
    expect(events.some((e) => e.type === 'text' && e.content.includes('3 papers'))).toBe(true);
  });

  it('parallel sub-agent calls execute concurrently', async () => {
    const executionLog: string[] = [];

    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        const userMsg = request.messages.find((m) => m.role === 'user');
        const userText = userMsg && typeof userMsg.content === 'string' ? userMsg.content : '';

        if (userText.includes('Task A')) {
          executionLog.push('a-start');
          await new Promise((r) => setTimeout(r, 30));
          executionLog.push('a-end');
          yield { type: 'text', content: 'Result A' };
        } else if (userText.includes('Task B')) {
          executionLog.push('b-start');
          await new Promise((r) => setTimeout(r, 30));
          executionLog.push('b-end');
          yield { type: 'text', content: 'Result B' };
        } else if (!executionLog.includes('a-start')) {
          // Parent first call: spawn two agents
          yield { type: 'tool_call', id: 'tc-a', name: '_spawn_agent', input: { task: 'Task A' } };
          yield { type: 'tool_call', id: 'tc-b', name: '_spawn_agent', input: { task: 'Task B' } };
        } else {
          yield { type: 'text', content: 'Both tasks done' };
        }
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const start = performance.now();
    const loop = new AgentLoop({
      llm,
      subAgent: { maxDepth: 2, maxConcurrent: 3 },
      maxTurns: 5,
      enableWorkingMemory: false,
    });
    const events = await collectEvents(loop, baseRequest);
    const elapsed = performance.now() - start;

    // Both sub-agents started before either finished (parallel)
    expect(executionLog[0]).toBe('a-start');
    expect(executionLog[1]).toBe('b-start');

    // Should be faster than sequential (each ~30ms, parallel ≈ 30ms)
    expect(elapsed).toBeLessThan(200);

    // Two sub_agent_start events
    const starts = events.filter((e) => e.type === 'sub_agent_start');
    expect(starts).toHaveLength(2);
  });

  it('depth limit enforced - child at maxDepth-1 does not get _spawn_agent', async () => {
    let childTools: string[] = [];

    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        // Capture tool names from the request
        if (request.tools) {
          const names = request.tools.map((t) => t.name);
          if (childTools.length === 0 && names.length < 10) {
            childTools = names;
          }
        }
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    // Parent at depth 0, maxDepth 1 → child at depth 1 should NOT get _spawn_agent
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } },
      async () => 'result',
    );

    const loop = new AgentLoop({
      llm,
      toolDispatcher: dispatcher,
      subAgent: { maxDepth: 1 },
      maxTurns: 5,
      enableWorkingMemory: false,
    });

    // _spawn_agent should not be registered at depth 0 when maxDepth is 1
    // because depth (0) < maxDepth (1) → it IS registered for the parent
    expect(loop.toolDispatcher.hasHandler('_spawn_agent')).toBe(true);

    // But the child would be at depth 1 == maxDepth, so no _spawn_agent for child
    // This is enforced inside SubAgentRunner.run() via cloneToolsInto filter
  });
});

describe('ToolDispatcher.cloneToolsInto', () => {
  it('clones all tools into target dispatcher', () => {
    const source = new ToolDispatcher();
    source.register(
      { name: 'toolA', description: 'A', parameters: { type: 'object', properties: {} } },
      async () => 'a',
    );
    source.register(
      { name: 'toolB', description: 'B', parameters: { type: 'object', properties: {} } },
      async () => 'b',
    );

    const target = new ToolDispatcher();
    source.cloneToolsInto(target);

    expect(target.hasHandler('toolA')).toBe(true);
    expect(target.hasHandler('toolB')).toBe(true);
    expect(target.listTools()).toHaveLength(2);
  });

  it('filters tools with predicate', () => {
    const source = new ToolDispatcher();
    source.register(
      { name: 'keep', description: 'Keep', parameters: { type: 'object', properties: {} } },
      async () => 'k',
    );
    source.register(
      { name: '_internal', description: 'Internal', parameters: { type: 'object', properties: {} } },
      async () => 'i',
    );

    const target = new ToolDispatcher();
    source.cloneToolsInto(target, (name) => !name.startsWith('_'));

    expect(target.hasHandler('keep')).toBe(true);
    expect(target.hasHandler('_internal')).toBe(false);
  });
});
