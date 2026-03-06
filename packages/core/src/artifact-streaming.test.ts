import { describe, it, expect, vi } from 'vitest';
import { AgentLoop, chunkArtifactContent, buildArtifactPrompt, type ArtifactStoreInterface } from './agent-loop.js';
import { ToolDispatcher, type ToolExecutionContext } from './dispatcher.js';
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
  conversationId: 'art-conv',
  input: { type: 'text' as const, text: 'create' },
  teamId: 'team-a',
  userId: 'user-1',
};

// --- chunkArtifactContent unit tests ---

describe('chunkArtifactContent', () => {
  it('splits content at specified chunk size', () => {
    const content = 'a'.repeat(1200);
    const chunks = chunkArtifactContent(content, 500);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(content);
  });

  it('returns single chunk for short content', () => {
    const chunks = chunkArtifactContent('hello', 500);
    expect(chunks).toEqual(['hello']);
  });

  it('prefers newline boundaries', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n';
    // chunkSize 15 would cut in the middle, but \n at position 5 or 11 should be preferred
    const chunks = chunkArtifactContent(content, 15);
    // Each chunk should end at a newline
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith('\n')).toBe(true);
    }
    expect(chunks.join('')).toBe(content);
  });

  it('returns empty array for empty content', () => {
    expect(chunkArtifactContent('', 500)).toEqual([]);
  });
});

// --- Artifact streaming integration tests ---

describe('Artifact streaming', () => {
  function createMockArtifactStore(): ArtifactStoreInterface {
    return {
      create: vi.fn().mockImplementation((input) => ({
        id: 'art-1',
        currentVersion: 1,
        content: input.content,
      })),
      update: vi.fn().mockImplementation((_id, content) => ({
        id: 'art-1',
        currentVersion: 2,
        content,
      })),
    };
  }

  it('streams artifact_create → artifact_stream(s) → artifact_done', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'gen-code', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Created' }, { type: 'done' }],
    ]);

    const content = 'const x = 1;\nconst y = 2;\nconst z = x + y;\n';
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'gen-code', description: 'Gen', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'Generated code',
        artifacts: [{
          type: 'create' as const,
          artifactId: '',
          title: 'app.ts',
          content,
          artifactType: 'code' as const,
          language: 'typescript',
        }],
      }),
    );

    const store = createMockArtifactStore();
    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, artifactStore: store, artifactStreamChunkSize: 20 });
    const events = await collectEvents(loop, baseRequest);

    // Should have artifact_create with empty content
    const createEvent = events.find((e) => e.type === 'artifact_create');
    expect(createEvent).toBeDefined();
    if (createEvent?.type === 'artifact_create') {
      expect(createEvent.content).toBe('');
    }

    // Should have artifact_stream deltas
    const streamEvents = events.filter((e) => e.type === 'artifact_stream');
    expect(streamEvents.length).toBeGreaterThan(0);

    // Concatenated deltas should equal original content
    const reconstructed = streamEvents
      .map((e) => (e as { type: 'artifact_stream'; delta: string }).delta)
      .join('');
    expect(reconstructed).toBe(content);

    // Should end with artifact_done
    const doneEvent = events.find((e) => e.type === 'artifact_done');
    expect(doneEvent).toBeDefined();
  });

  it('streams artifact_update → artifact_stream(s) → artifact_done', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'update-code', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Updated' }, { type: 'done' }],
    ]);

    const content = 'updated content line 1\nupdated content line 2\n';
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'update-code', description: 'Update', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'Updated code',
        artifacts: [{
          type: 'update' as const,
          artifactId: 'art-1',
          title: 'app.ts',
          content,
        }],
      }),
    );

    const store = createMockArtifactStore();
    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, artifactStore: store, artifactStreamChunkSize: 25 });
    const events = await collectEvents(loop, baseRequest);

    const updateEvent = events.find((e) => e.type === 'artifact_update');
    expect(updateEvent).toBeDefined();
    if (updateEvent?.type === 'artifact_update') {
      expect(updateEvent.content).toBe('');
    }

    const streamEvents = events.filter((e) => e.type === 'artifact_stream');
    expect(streamEvents.length).toBeGreaterThan(0);

    const reconstructed = streamEvents
      .map((e) => (e as { type: 'artifact_stream'; delta: string }).delta)
      .join('');
    expect(reconstructed).toBe(content);
  });

  it('store receives full content before streaming begins', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'gen', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    const fullContent = 'full artifact content';
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'gen', description: 'Gen', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'ok',
        artifacts: [{ type: 'create' as const, artifactId: '', title: 'doc', content: fullContent }],
      }),
    );

    const store = createMockArtifactStore();
    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, artifactStore: store });
    await collectEvents(loop, baseRequest);

    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ content: fullContent }));
  });
});

// --- buildArtifactPrompt unit tests ---

describe('buildArtifactPrompt', () => {
  it('formats artifacts correctly', () => {
    const artifacts = [
      { id: '1', title: 'app.ts', type: 'code', language: 'typescript', currentVersion: 2 },
      { id: '2', title: 'README.md', type: 'document', language: null, currentVersion: 1 },
    ];
    const result = buildArtifactPrompt(artifacts, 500);
    expect(result).toContain('## Artifacts');
    expect(result).toContain('[code, typescript] app.ts (v2)');
    expect(result).toContain('[document] README.md (v1)');
  });

  it('returns empty string for no artifacts', () => {
    expect(buildArtifactPrompt([], 500)).toBe('');
  });

  it('respects token budget', () => {
    const artifacts = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      title: `file-${i}.ts`,
      type: 'code',
      language: 'typescript',
      currentVersion: 1,
    }));
    // Very small budget — should not include all 100
    const result = buildArtifactPrompt(artifacts, 20);
    const lines = result.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThan(100);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('includes language when present', () => {
    const result = buildArtifactPrompt([
      { id: '1', title: 'x.py', type: 'code', language: 'python', currentVersion: 1 },
    ], 500);
    expect(result).toContain('[code, python]');
  });

  it('omits language when null', () => {
    const result = buildArtifactPrompt([
      { id: '1', title: 'notes.md', type: 'document', language: null, currentVersion: 1 },
    ], 500);
    expect(result).toContain('[document]');
    expect(result).not.toContain('[document, ');
  });
});

// --- Artifact context in system prompt tests ---

describe('Artifact context injection', () => {
  it('includes ## Artifacts in system prompt when artifacts exist', async () => {
    let capturedMessages: any[] = [];
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest) {
        capturedMessages = request.messages;
        yield { type: 'text' as const, content: 'ok' };
        yield { type: 'done' as const };
      },
      async countTokens() { return 100; },
    };

    const store: ArtifactStoreInterface = {
      create: vi.fn(),
      update: vi.fn(),
      listByConversation: vi.fn().mockResolvedValue([
        { id: '1', title: 'app.ts', type: 'code', language: 'typescript', currentVersion: 2 },
      ]),
    };

    const loop = new AgentLoop({ llm, artifactStore: store });
    await collectEvents(loop, baseRequest);

    const systemMsg = capturedMessages[0] as { content: string };
    expect(systemMsg.content).toContain('## Artifacts');
    expect(systemMsg.content).toContain('app.ts');
  });

  it('does not modify system prompt when no artifacts', async () => {
    let capturedMessages: any[] = [];
    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096 }],
      async *chat(request: LlmRequest) {
        capturedMessages = request.messages;
        yield { type: 'text' as const, content: 'ok' };
        yield { type: 'done' as const };
      },
      async countTokens() { return 100; },
    };

    const store: ArtifactStoreInterface = {
      create: vi.fn(),
      update: vi.fn(),
      listByConversation: vi.fn().mockResolvedValue([]),
    };

    const loop = new AgentLoop({ llm, artifactStore: store, systemPrompt: 'Base prompt' });
    await collectEvents(loop, baseRequest);

    const systemMsg = capturedMessages[0] as { content: string };
    expect(systemMsg.content).toContain('Base prompt');
    expect(systemMsg.content).not.toContain('## Artifacts');
  });

  it('calls listByConversation once per run', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc', name: 'echo', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'done' }, { type: 'done' }],
    ]);

    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );

    const listFn = vi.fn().mockResolvedValue([]);
    const store: ArtifactStoreInterface = {
      create: vi.fn(),
      update: vi.fn(),
      listByConversation: listFn,
    };

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher, artifactStore: store });
    await collectEvents(loop, baseRequest);

    // Two LLM turns but listByConversation should only be called once
    expect(listFn).toHaveBeenCalledTimes(1);
  });
});

// --- ToolExecutionContext passing tests ---

describe('AgentLoop execution context', () => {
  it('passes context at tool dispatch site', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'ctx-check', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    let receivedContext: ToolExecutionContext | undefined;
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'ctx-check', description: 'Check', parameters: { type: 'object', properties: {} } },
      async (_input, context?) => {
        receivedContext = context;
        return 'ok';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    await collectEvents(loop, {
      ...baseRequest,
      workspaceId: 'ws-123',
    });

    expect(receivedContext).toBeDefined();
    expect(receivedContext!.conversationId).toBe('art-conv');
    expect(receivedContext!.workspaceId).toBe('ws-123');
    expect(receivedContext!.userId).toBe('user-1');
    expect(receivedContext!.teamId).toBe('team-a');
  });

  it('passes context at action dispatch site', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'action-tool', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'Step 1' }, { type: 'done' }],
    ]);

    let actionContext: ToolExecutionContext | undefined;
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'action-tool', description: 'Action', parameters: { type: 'object', properties: {} } },
      async (input, context?) => {
        if (input._action) {
          actionContext = context;
          return 'Action done';
        }
        return {
          content: 'Step 1',
          blocks: [{ type: 'action' as const, actions: [{ id: 'go', label: 'Go' }] }],
        };
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });

    // First: register actions
    await collectEvents(loop, baseRequest);

    // Second: action dispatch
    await collectEvents(loop, {
      ...baseRequest,
      input: { type: 'action', actionId: 'go', payload: {} },
    });

    expect(actionContext).toBeDefined();
    expect(actionContext!.conversationId).toBe('art-conv');
  });

  it('context has undefined workspaceId when not provided', async () => {
    const llm = createMockLlm([
      [
        { type: 'tool_call', id: 'tc-1', name: 'ctx-check', input: {} },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'ok' }, { type: 'done' }],
    ]);

    let receivedContext: ToolExecutionContext | undefined;
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'ctx-check', description: 'Check', parameters: { type: 'object', properties: {} } },
      async (_input, context?) => {
        receivedContext = context;
        return 'ok';
      },
    );

    const loop = new AgentLoop({ llm, toolDispatcher: dispatcher });
    await collectEvents(loop, baseRequest); // No workspaceId in baseRequest

    expect(receivedContext).toBeDefined();
    expect(receivedContext!.workspaceId).toBeUndefined();
  });
});
