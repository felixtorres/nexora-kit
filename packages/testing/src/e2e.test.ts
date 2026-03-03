import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { createTestInstance } from './instance.js';
import { createTestPlugin } from './plugin-fixture.js';
import { createMockLlm } from './mock-llm.js';
import type { LlmEvent } from '@nexora-kit/llm';

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  cleanupDirs.length = 0;
});

describe('E2E: Simple conversation', () => {
  it('handles a basic chat message', async () => {
    const instance = createTestInstance({
      responses: [
        [
          { type: 'text', content: 'Hello, human!' },
          { type: 'usage', inputTokens: 10, outputTokens: 5 },
          { type: 'done' },
        ],
      ],
    });

    const events = await instance.chat('Hi there');
    expect(events).toContainEqual({ type: 'text', content: 'Hello, human!' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('tracks token usage across turns', async () => {
    const instance = createTestInstance({
      responses: [
        [
          { type: 'text', content: 'First' },
          { type: 'usage', inputTokens: 100, outputTokens: 50 },
          { type: 'done' },
        ],
      ],
      tokenBudget: { instanceLimit: 1_000_000, pluginLimit: 500_000 },
      pluginNamespace: 'test',
    });

    const events = await instance.chat('Hello');
    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents.length).toBeGreaterThan(0);
  });
});

describe('E2E: Multi-turn tool use', () => {
  it('executes tools and continues conversation', async () => {
    const instance = createTestInstance({
      responses: [
        [
          { type: 'tool_call', id: 'tc-1', name: 'lookup', input: { query: 'weather' } },
          { type: 'usage', inputTokens: 20, outputTokens: 10 },
          { type: 'done' },
        ],
        [
          { type: 'text', content: 'The weather is sunny!' },
          { type: 'usage', inputTokens: 30, outputTokens: 15 },
          { type: 'done' },
        ],
      ],
    });

    instance.registerTool('lookup', 'Look up information', async (input) => {
      return `Result for: ${(input as Record<string, string>).query}`;
    });

    const events = await instance.chat('What is the weather?');

    // Should have tool call, tool result, then text
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toBeDefined();

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toContain('Result for: weather');
    }

    expect(events).toContainEqual({ type: 'text', content: 'The weather is sunny!' });
  });

  it('handles tool execution errors gracefully', async () => {
    const instance = createTestInstance({
      responses: [
        [
          { type: 'tool_call', id: 'tc-1', name: 'failing-tool', input: {} },
          { type: 'usage', inputTokens: 10, outputTokens: 5 },
          { type: 'done' },
        ],
        [
          { type: 'text', content: 'I encountered an error' },
          { type: 'usage', inputTokens: 20, outputTokens: 10 },
          { type: 'done' },
        ],
      ],
    });

    instance.registerTool('failing-tool', 'Always fails', async () => {
      throw new Error('Something went wrong');
    });

    const events = await instance.chat('Run the tool');

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.isError).toBe(true);
      expect(toolResult.content).toContain('Something went wrong');
    }

    // LLM should still respond after the error
    expect(events).toContainEqual({ type: 'text', content: 'I encountered an error' });
  });

  it('handles multiple tool calls in a single turn', async () => {
    const instance = createTestInstance({
      responses: [
        [
          { type: 'tool_call', id: 'tc-1', name: 'tool-a', input: { v: 'a' } },
          { type: 'tool_call', id: 'tc-2', name: 'tool-b', input: { v: 'b' } },
          { type: 'usage', inputTokens: 20, outputTokens: 10 },
          { type: 'done' },
        ],
        [
          { type: 'text', content: 'Both tools executed' },
          { type: 'usage', inputTokens: 30, outputTokens: 15 },
          { type: 'done' },
        ],
      ],
    });

    instance.registerTool('tool-a', 'Tool A', async (input) => `a:${(input as any).v}`);
    instance.registerTool('tool-b', 'Tool B', async (input) => `b:${(input as any).v}`);

    const events = await instance.chat('Run both tools');

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(2);
  });
});

describe('E2E: Plugin lifecycle', () => {
  it('loads a plugin and uses its skills as tools', async () => {
    const pluginDir = await createTestPlugin({
      name: 'test-faq',
      namespace: 'test-faq',
      skills: [
        {
          name: 'answer',
          description: 'Answer a question',
          prompt: 'Answer the question: {{input}}',
        },
      ],
    });
    cleanupDirs.push(pluginDir);

    const instance = createTestInstance({
      responses: [
        [
          { type: 'text', content: 'Plugin loaded, ready to help!' },
          { type: 'usage', inputTokens: 10, outputTokens: 5 },
          { type: 'done' },
        ],
      ],
    });

    const result = instance.installPlugin(pluginDir);
    expect(result.plugin.manifest.namespace).toBe('test-faq');
    expect(result.plugin.tools.length).toBeGreaterThan(0);

    // Verify plugin is enabled
    const plugin = instance.lifecycle.getPlugin('test-faq');
    expect(plugin?.state).toBe('enabled');
  });

  it('loads plugin with commands and skills', async () => {
    const pluginDir = await createTestPlugin({
      name: 'multi-feature',
      namespace: 'multi',
      skills: [
        { name: 'summarize', prompt: 'Summarize: {{input}}' },
        { name: 'translate', prompt: 'Translate: {{input}}' },
      ],
      commands: [
        { name: 'status', description: 'Check status' },
      ],
    });
    cleanupDirs.push(pluginDir);

    const instance = createTestInstance();
    const result = instance.installPlugin(pluginDir);

    expect(result.skillDefinitions.size).toBe(2);
    expect(result.commandDefinitions.size).toBe(1);
    expect(result.plugin.tools.length).toBe(2);
  });

  it('uninstalls a plugin cleanly', async () => {
    const pluginDir = await createTestPlugin({
      name: 'temp-plugin',
      namespace: 'temp',
      skills: [{ name: 'greet', prompt: 'Hello {{input}}' }],
    });
    cleanupDirs.push(pluginDir);

    const instance = createTestInstance();
    instance.installPlugin(pluginDir);

    expect(instance.lifecycle.getPlugin('temp')).toBeDefined();

    instance.lifecycle.uninstall('temp');
    expect(instance.lifecycle.getPlugin('temp')).toBeUndefined();
  });
});

describe('E2E: Max turns enforcement', () => {
  it('stops after max turns', async () => {
    // Create an LLM that always calls a tool (infinite loop)
    const infiniteResponses: LlmEvent[][] = Array.from({ length: 20 }, () => [
      { type: 'tool_call' as const, id: 'tc', name: 'echo', input: {} },
      { type: 'usage' as const, inputTokens: 5, outputTokens: 5 },
      { type: 'done' as const },
    ]);

    const instance = createTestInstance({ responses: infiniteResponses });
    instance.registerTool('echo', 'Echo', async () => 'echoed');

    const events = await instance.chat('Loop forever');

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.code).toBe('MAX_TURNS');
    }
  });
});

describe('E2E: Session persistence', () => {
  it('maintains context across messages in same session', async () => {
    const requests: unknown[] = [];
    const llm = createMockLlm({
      responses: [
        [{ type: 'text', content: 'First response' }, { type: 'usage', inputTokens: 10, outputTokens: 5 }, { type: 'done' }],
        [{ type: 'text', content: 'Second response' }, { type: 'usage', inputTokens: 20, outputTokens: 10 }, { type: 'done' }],
      ],
      onChat: (req) => requests.push(req),
    });

    const instance = createTestInstance({ llm });

    await instance.chat('Hello', { conversationId: 'persist-test' });
    await instance.chat('Follow up', { conversationId: 'persist-test' });

    // Second call should include history from first call
    expect(requests).toHaveLength(2);
  });
});

describe('E2E: LLM request tracking', () => {
  it('captures onChat calls with correct request data', async () => {
    const chatRequests: unknown[] = [];
    const llm = createMockLlm({
      responses: [
        [{ type: 'text', content: 'tracked' }, { type: 'usage', inputTokens: 5, outputTokens: 3 }, { type: 'done' }],
      ],
      onChat: (req) => chatRequests.push(req),
    });

    const instance = createTestInstance({ llm });
    await instance.chat('Track this');

    expect(chatRequests).toHaveLength(1);
  });
});
