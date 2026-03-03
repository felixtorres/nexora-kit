import { describe, it, expect, vi } from 'vitest';
import { SkillHandlerFactory } from './handler-factory.js';
import type { SkillDefinition } from './types.js';
import type { LlmProvider } from '@nexora-kit/llm';
import { ConfigResolver } from '@nexora-kit/config';

function createMockLlm(responseText: string): LlmProvider {
  return {
    name: 'mock',
    models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 4096, maxOutputTokens: 1024 }],
    async *chat() {
      yield { type: 'text' as const, content: responseText };
      yield { type: 'done' as const };
    },
    async countTokens() {
      return 10;
    },
  };
}

describe('SkillHandlerFactory', () => {
  it('creates a prompt-based handler that calls LLM', async () => {
    const llm = createMockLlm('Hello Felix!');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'greet',
      description: 'Greet user',
      invocation: 'model',
      parameters: { userName: { type: 'string' } },
      prompt: 'Say hi to {{userName}}',
    };

    const handler = factory.createHandler('hello:greet', skillDef, 'hello');
    const result = await handler({ userName: 'Felix' });

    expect(result).toBe('Hello Felix!');
  });

  it('renders template variables before sending to LLM', async () => {
    const chatSpy = vi.fn(async function* () {
      yield { type: 'text' as const, content: 'response' };
      yield { type: 'done' as const };
    });

    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 4096, maxOutputTokens: 1024 }],
      chat: chatSpy,
      async countTokens() { return 10; },
    };

    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'greet',
      description: 'Greet',
      invocation: 'model',
      parameters: {},
      prompt: 'Hello {{name}}',
    };

    await factory.createHandler('ns:greet', skillDef, 'ns')({ name: 'World' });

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hello World' }],
      }),
    );
  });

  it('creates a code handler that invokes the skill handler function', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'calc',
      description: 'Calculate',
      invocation: 'model',
      parameters: {},
      handler: async (ctx) => ({
        output: `Result: ${Number(ctx.input.a) + Number(ctx.input.b)}`,
      }),
    };

    const handler = factory.createHandler('ns:calc', skillDef, 'ns');
    const result = await handler({ a: 3, b: 7 });

    expect(result).toBe('Result: 10');
  });

  it('code handler throws on error result', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'fail',
      description: 'Fail',
      invocation: 'model',
      parameters: {},
      handler: async () => ({ output: 'something broke', isError: true }),
    };

    const handler = factory.createHandler('ns:fail', skillDef, 'ns');
    await expect(handler({})).rejects.toThrow('something broke');
  });

  it('returns fallback message for skill with no handler or prompt', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'empty',
      description: 'Empty skill',
      invocation: 'model',
      parameters: {},
    };

    const handler = factory.createHandler('ns:empty', skillDef, 'ns');
    const result = await handler({});

    expect(result).toContain('no handler or prompt');
  });

  it('includes config values in template context', async () => {
    const chatSpy = vi.fn(async function* () {
      yield { type: 'text' as const, content: 'ok' };
      yield { type: 'done' as const };
    });

    const llm: LlmProvider = {
      name: 'mock',
      models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 4096, maxOutputTokens: 1024 }],
      chat: chatSpy,
      async countTokens() { return 10; },
    };

    const config = new ConfigResolver();
    config.set('greeting', 'Howdy', 2, { pluginNamespace: 'hello' });

    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'greet',
      description: 'Greet',
      invocation: 'model',
      parameters: {},
      prompt: 'Use this greeting: {{config.greeting}}',
    };

    await factory.createHandler('hello:greet', skillDef, 'hello')({});

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Use this greeting: Howdy' }],
      }),
    );
  });

  it('code handler receives config values in context', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    config.set('ns.key', 'val', 2, { pluginNamespace: 'ns' });

    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    let capturedConfig: Record<string, unknown> = {};
    const skillDef: SkillDefinition = {
      name: 'check',
      description: 'Check config',
      invocation: 'model',
      parameters: {},
      handler: async (ctx) => {
        capturedConfig = ctx.config;
        return { output: 'ok' };
      },
    };

    await factory.createHandler('ns:check', skillDef, 'ns')({});
    expect(capturedConfig).toHaveProperty('ns.key', 'val');
  });

  it('code handler invoke stub throws not implemented', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    let invokeError: Error | undefined;
    const skillDef: SkillDefinition = {
      name: 'compose',
      description: 'Compose',
      invocation: 'model',
      parameters: {},
      handler: async (ctx) => {
        try {
          await ctx.invoke('other:skill', {});
        } catch (e) {
          invokeError = e as Error;
        }
        return { output: 'ok' };
      },
    };

    await factory.createHandler('ns:compose', skillDef, 'ns')({});
    expect(invokeError).toBeDefined();
    expect(invokeError!.message).toContain('not yet implemented');
  });

  it('code handler returns structured response with blocks', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'card-skill',
      description: 'Returns blocks',
      invocation: 'model',
      parameters: {},
      handler: async () => ({
        output: [
          { type: 'card', title: 'Order #1', body: 'Ready for pickup' },
          { type: 'action', actions: [{ id: 'confirm', label: 'Confirm' }] },
        ],
      }),
    };

    const handler = factory.createHandler('ns:card-skill', skillDef, 'ns');
    const result = await handler({});

    // Should return structured response, not stringified JSON
    expect(typeof result).toBe('object');
    expect((result as any).blocks).toHaveLength(2);
    expect((result as any).blocks[0].type).toBe('card');
    expect((result as any).content).toBe('');
  });

  it('code handler preserves string return (backward compat)', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'text-skill',
      description: 'Returns text',
      invocation: 'model',
      parameters: {},
      handler: async () => ({ output: 'plain text result' }),
    };

    const handler = factory.createHandler('ns:text-skill', skillDef, 'ns');
    const result = await handler({});

    expect(result).toBe('plain text result');
  });

  it('code handler throws on error with blocks output', async () => {
    const llm = createMockLlm('unused');
    const config = new ConfigResolver();
    const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

    const skillDef: SkillDefinition = {
      name: 'fail-blocks',
      description: 'Fails with blocks',
      invocation: 'model',
      parameters: {},
      handler: async () => ({
        output: [{ type: 'text', content: 'error info' }],
        isError: true,
      }),
    };

    const handler = factory.createHandler('ns:fail-blocks', skillDef, 'ns');
    await expect(handler({})).rejects.toThrow();
  });
});
