import { describe, it, expect } from 'vitest';
import { BotRunner, type BotConfig } from './bot-runner.js';
import type { ChatRequest, ChatEvent } from './types.js';

function createMockAgentLoop(events: ChatEvent[]) {
  return {
    async *run(_request: ChatRequest, _signal?: AbortSignal): AsyncIterable<ChatEvent> {
      for (const event of events) {
        yield event;
      }
    },
  } as any;
}

const baseBotConfig: BotConfig = {
  botId: 'bot-1',
  botName: 'Support Bot',
  systemPrompt: 'You are a support bot.',
  model: 'claude-sonnet-4-6',
  maxTurns: 5,
  temperature: 0.7,
  pluginNamespaces: ['faq'],
};

const baseRequest: ChatRequest = {
  conversationId: 'conv-1',
  input: { type: 'text', text: 'Hello' },
  teamId: 'team-1',
  userId: 'user-1',
};

describe('BotRunner', () => {
  describe('run()', () => {
    it('yields events from agent loop', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'Hello! ' },
        { type: 'text', content: 'How can I help?' },
        { type: 'done' },
      ];

      const runner = new BotRunner(createMockAgentLoop(events), baseBotConfig);
      const collected: ChatEvent[] = [];

      for await (const event of runner.run(baseRequest)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(3);
      expect(collected[0]).toEqual({ type: 'text', content: 'Hello! ' });
      expect(collected[2]).toEqual({ type: 'done' });
    });

    it('injects bot metadata into request', async () => {
      let capturedRequest: ChatRequest | undefined;

      const mockLoop = {
        async *run(request: ChatRequest) {
          capturedRequest = request;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const runner = new BotRunner(mockLoop, baseBotConfig);
      for await (const _ of runner.run(baseRequest)) { /* consume */ }

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.metadata?._botId).toBe('bot-1');
      expect(capturedRequest!.metadata?._botName).toBe('Support Bot');
      expect(capturedRequest!.systemPrompt).toBe('You are a support bot.');
      expect(capturedRequest!.model).toBe('claude-sonnet-4-6');
    });

    it('overrides pluginNamespaces with bot config', async () => {
      let capturedRequest: ChatRequest | undefined;

      const mockLoop = {
        async *run(request: ChatRequest) {
          capturedRequest = request;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const runner = new BotRunner(mockLoop, baseBotConfig);
      for await (const _ of runner.run({
        ...baseRequest,
        pluginNamespaces: ['original'],
      })) { /* consume */ }

      expect(capturedRequest!.pluginNamespaces).toEqual(['faq']);
    });

    it('falls back to request pluginNamespaces if bot has none', async () => {
      let capturedRequest: ChatRequest | undefined;

      const mockLoop = {
        async *run(request: ChatRequest) {
          capturedRequest = request;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const runner = new BotRunner(mockLoop, {
        ...baseBotConfig,
        pluginNamespaces: undefined,
      });
      for await (const _ of runner.run({
        ...baseRequest,
        pluginNamespaces: ['original'],
      })) { /* consume */ }

      expect(capturedRequest!.pluginNamespaces).toEqual(['original']);
    });
  });

  describe('runToCompletion()', () => {
    it('collects text events into content string', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'Hello ' },
        { type: 'text', content: 'world!' },
        { type: 'done' },
      ];

      const runner = new BotRunner(createMockAgentLoop(events), baseBotConfig);
      const response = await runner.runToCompletion(baseRequest);

      expect(response.botId).toBe('bot-1');
      expect(response.botName).toBe('Support Bot');
      expect(response.content).toBe('Hello world!');
      expect(response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('sums token usage', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'Hi' },
        { type: 'usage', inputTokens: 100, outputTokens: 50 },
        { type: 'usage', inputTokens: 20, outputTokens: 10 },
        { type: 'done' },
      ];

      const runner = new BotRunner(createMockAgentLoop(events), baseBotConfig);
      const response = await runner.runToCompletion(baseRequest);

      expect(response.tokensUsed).toBe(180);
    });

    it('returns empty content when no text events', async () => {
      const events: ChatEvent[] = [
        { type: 'done' },
      ];

      const runner = new BotRunner(createMockAgentLoop(events), baseBotConfig);
      const response = await runner.runToCompletion(baseRequest);

      expect(response.content).toBe('');
      expect(response.tokensUsed).toBe(0);
    });

    it('respects abort signal', async () => {
      let receivedSignal: AbortSignal | undefined;

      const mockLoop = {
        async *run(request: ChatRequest, signal?: AbortSignal) {
          receivedSignal = signal;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const controller = new AbortController();
      const runner = new BotRunner(mockLoop, baseBotConfig);
      await runner.runToCompletion(baseRequest, controller.signal);

      expect(receivedSignal).toBe(controller.signal);
    });
  });
});
