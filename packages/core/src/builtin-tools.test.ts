import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { LlmProvider, LlmEvent, LlmRequest } from '@nexora-kit/llm';
import type { ChatEvent } from './types.js';
import type { UserMemoryStoreInterface } from './user-memory-interface.js';

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

describe('Built-in tools', () => {
  it('_note_to_self stores and _recall retrieves', async () => {
    const llm = createMockLlm([
      // Turn 1: LLM saves a note
      [
        { type: 'tool_call', id: 'tc-1', name: '_note_to_self', input: { note: 'user wants JSON' } },
        { type: 'done' },
      ],
      // Turn 2: LLM recalls notes
      [
        { type: 'tool_call', id: 'tc-2', name: '_recall', input: {} },
        { type: 'done' },
      ],
      // Turn 3: text response
      [
        { type: 'text', content: 'Done' },
        { type: 'done' },
      ],
    ]);

    const loop = new AgentLoop({ llm, maxTurns: 5 });
    const events = await collectEvents(loop, baseRequest);

    const results = events.filter((e) => e.type === 'tool_result');
    expect(results).toHaveLength(2);

    // _note_to_self result
    if (results[0].type === 'tool_result') {
      expect(results[0].content).toContain('Note saved');
      expect(results[0].content).toContain('1 notes');
    }

    // _recall result
    if (results[1].type === 'tool_result') {
      expect(results[1].content).toContain('user wants JSON');
    }
  });

  it('_save_to_memory calls user memory store', async () => {
    const mockStore: UserMemoryStoreInterface = {
      set: vi.fn(),
    };

    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: '_save_to_memory', input: { fact: 'prefers TypeScript', namespace: 'preferences' } },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Saved' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({ llm, userMemoryStore: mockStore, maxTurns: 5 });
    const events = await collectEvents(loop, baseRequest);

    expect(mockStore.set).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        value: 'prefers TypeScript',
        namespace: 'preferences',
        source: 'llm',
      }),
    );

    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toBeDefined();
    if (result?.type === 'tool_result') {
      expect(result.content).toContain('saved to permanent memory');
    }
  });

  it('_save_to_memory not registered without userMemoryStore', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: '_save_to_memory', input: { fact: 'test' } },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'fail' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({ llm, maxTurns: 5 });
    const events = await collectEvents(loop, baseRequest);

    const result = events.find((e) => e.type === 'tool_result');
    if (result?.type === 'tool_result') {
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    }
  });

  it('enableWorkingMemory=false does not register built-in tools', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: '_note_to_self', input: { note: 'test' } },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'fail' }, { type: 'done' }],
    ]);

    const loop = new AgentLoop({ llm, enableWorkingMemory: false, maxTurns: 5 });
    const events = await collectEvents(loop, baseRequest);

    const result = events.find((e) => e.type === 'tool_result');
    if (result?.type === 'tool_result') {
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    }
  });

  it('working memory notes appear in system prompt on subsequent turns', async () => {
    let capturedSystemPrompts: string[] = [];
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        const sysMsg = request.messages.find((m) => m.role === 'system');
        if (sysMsg && typeof sysMsg.content === 'string') {
          capturedSystemPrompts.push(sysMsg.content);
        }
        if (capturedSystemPrompts.length === 1) {
          // First turn: save a note
          yield { type: 'tool_call', id: 'tc-1', name: '_note_to_self', input: { note: 'important finding' } };
        } else {
          yield { type: 'text', content: 'done' };
        }
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({ llm, maxTurns: 5 });
    await collectEvents(loop, baseRequest);

    // Second turn's system prompt should include the note
    expect(capturedSystemPrompts.length).toBeGreaterThanOrEqual(2);
    expect(capturedSystemPrompts[1]).toContain('important finding');
    expect(capturedSystemPrompts[1]).toContain('Working Memory');
  });

  it('turn reminders appear when approaching maxTurns', async () => {
    let capturedSystemPrompts: string[] = [];
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
        const sysMsg = request.messages.find((m) => m.role === 'system');
        if (sysMsg && typeof sysMsg.content === 'string') {
          capturedSystemPrompts.push(sysMsg.content);
        }
        if (capturedSystemPrompts.length < 4) {
          yield { type: 'tool_call', id: `tc-${capturedSystemPrompts.length}`, name: '_recall', input: {} };
        } else {
          yield { type: 'text', content: 'done' };
        }
        yield { type: 'done' };
      },
      async countTokens() { return 100; },
    };

    const loop = new AgentLoop({ llm, maxTurns: 4 });
    await collectEvents(loop, baseRequest);

    // Turn 2 of 4 = 2 remaining, should have reminder
    const hasReminder = capturedSystemPrompts.some((p) => p.includes('turn(s) remaining'));
    expect(hasReminder).toBe(true);
  });
});
