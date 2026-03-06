import { describe, it, expect } from 'vitest';
import { Orchestrator, type OrchestratorConfig, type OrchestratorBotBinding } from './orchestrator.js';
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

function makeBinding(overrides: Partial<OrchestratorBotBinding> = {}): OrchestratorBotBinding {
  return {
    botId: 'bot-1',
    botName: 'Support Bot',
    description: 'Handles support questions',
    keywords: ['help', 'support', 'issue'],
    priority: 1,
    config: {
      botId: 'bot-1',
      botName: 'Support Bot',
      systemPrompt: 'You are a support bot.',
      model: 'claude-sonnet-4-6',
    },
    ...overrides,
  };
}

const baseRequest: ChatRequest = {
  conversationId: 'conv-1',
  input: { type: 'text', text: 'I need help with billing' },
  teamId: 'team-1',
  userId: 'user-1',
};

describe('Orchestrator', () => {
  describe('route mode', () => {
    it('routes to bot matching keywords', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'I can help with billing!' },
        { type: 'done' },
      ];

      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: createMockAgentLoop(events),
        bindings: [
          makeBinding({
            botId: 'billing-bot',
            botName: 'Billing Bot',
            keywords: ['billing', 'invoice', 'payment'],
            priority: 5,
          }),
          makeBinding({
            botId: 'tech-bot',
            botName: 'Tech Bot',
            keywords: ['bug', 'error', 'crash'],
            priority: 1,
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];

      for await (const event of orchestrator.run(baseRequest)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0]).toEqual({ type: 'text', content: 'I can help with billing!' });
    });

    it('picks highest priority binding when multiple match', async () => {
      let capturedRequest: ChatRequest | undefined;

      const mockLoop = {
        async *run(request: ChatRequest) {
          capturedRequest = request;
          yield { type: 'text', content: 'Response' } as ChatEvent;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: mockLoop,
        bindings: [
          makeBinding({
            botId: 'low-priority',
            botName: 'Low',
            keywords: ['help'],
            priority: 1,
            config: { botId: 'low-priority', botName: 'Low', systemPrompt: 'low', model: 'm' },
          }),
          makeBinding({
            botId: 'high-priority',
            botName: 'High',
            keywords: ['help'],
            priority: 10,
            config: { botId: 'high-priority', botName: 'High', systemPrompt: 'high', model: 'm' },
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      for await (const _ of orchestrator.run(baseRequest)) { /* consume */ }

      // The high-priority bot should be selected
      expect(capturedRequest!.metadata?._botId).toBe('high-priority');
    });

    it('falls back to fallbackBotId when no keywords match', async () => {
      const mockLoop = {
        async *run(_request: ChatRequest) {
          yield { type: 'text', content: 'Fallback response' } as ChatEvent;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: mockLoop,
        fallbackBotId: 'general-bot',
        bindings: [
          makeBinding({
            botId: 'general-bot',
            botName: 'General',
            keywords: [],
            priority: 0,
            config: {
              botId: 'general-bot',
              botName: 'General',
              systemPrompt: 'General bot',
              model: 'model',
            },
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const request: ChatRequest = {
        ...baseRequest,
        input: { type: 'text', text: 'random unmatched question' },
      };

      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(request)) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({ type: 'text', content: 'Fallback response' });
    });

    it('emits error when no match and no fallback', async () => {
      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: createMockAgentLoop([]),
        bindings: [
          makeBinding({
            keywords: ['specific-keyword-only'],
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const request: ChatRequest = {
        ...baseRequest,
        input: { type: 'text', text: 'nothing matches' },
      };

      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(request)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(1);
      expect(collected[0].type).toBe('error');
    });

    it('handles string input in matching', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'matched' },
        { type: 'done' },
      ];

      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: createMockAgentLoop(events),
        bindings: [
          makeBinding({ keywords: ['help'] }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run({
        ...baseRequest,
        input: { type: 'text', text: 'I need help' },
      })) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({ type: 'text', content: 'matched' });
    });
  });

  describe('orchestrate mode', () => {
    it('fans out to bots when orchestrator makes tool calls', async () => {
      // Mock an agent loop that first emits tool calls, then text
      let callCount = 0;
      const mockLoop = {
        async *run(request: ChatRequest) {
          callCount++;
          if (callCount === 1 && request.metadata?._orchestrator) {
            // Orchestrator call — emit tool call
            yield {
              type: 'tool_call',
              id: 'tc-1',
              name: 'ask_support_bot',
              input: { question: 'Help with billing' },
            } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          } else {
            // Bot call
            yield { type: 'text', content: 'Bot response' } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          }
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'orchestrate',
        agentLoop: mockLoop,
        bindings: [makeBinding()],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(baseRequest)) {
        collected.push(event);
      }

      // Single bot response — no synthesis needed, yielded directly
      expect(collected.some((e) => e.type === 'text')).toBe(true);
    });

    it('synthesizes multiple bot responses', async () => {
      let callCount = 0;
      const mockLoop = {
        async *run(request: ChatRequest) {
          callCount++;
          if (callCount === 1 && request.metadata?._orchestrator) {
            yield {
              type: 'tool_call',
              id: 'tc-1',
              name: 'ask_support_bot',
              input: { question: 'Support question' },
            } as ChatEvent;
            yield {
              type: 'tool_call',
              id: 'tc-2',
              name: 'ask_billing_bot',
              input: { question: 'Billing question' },
            } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          } else if (request.metadata?._botId === 'bot-1') {
            yield { type: 'text', content: 'Support answer' } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          } else {
            yield { type: 'text', content: 'Billing answer' } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          }
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'orchestrate',
        agentLoop: mockLoop,
        bindings: [
          makeBinding({ botId: 'bot-1', botName: 'Support Bot' }),
          makeBinding({
            botId: 'bot-2',
            botName: 'Billing Bot',
            config: {
              botId: 'bot-2',
              botName: 'Billing Bot',
              systemPrompt: 'billing',
              model: 'model',
            },
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(baseRequest)) {
        collected.push(event);
      }

      const textEvents = collected.filter((e) => e.type === 'text');
      expect(textEvents.length).toBeGreaterThan(0);
      // Should contain both bot responses
      const fullText = textEvents.map((e) => (e as any).content).join('');
      expect(fullText).toContain('Support');
      expect(fullText).toContain('Billing');
    });

    it('uses fallback when orchestrator makes no tool calls', async () => {
      const mockLoop = {
        async *run(request: ChatRequest) {
          if (request.metadata?._orchestrator) {
            // Orchestrator makes no tool calls
            yield { type: 'text', content: 'I am not sure' } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          } else {
            yield { type: 'text', content: 'Fallback response' } as ChatEvent;
            yield { type: 'done' } as ChatEvent;
          }
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'orchestrate',
        agentLoop: mockLoop,
        fallbackBotId: 'fallback',
        bindings: [
          makeBinding({
            botId: 'fallback',
            botName: 'Fallback',
            config: {
              botId: 'fallback',
              botName: 'Fallback',
              systemPrompt: 'f',
              model: 'm',
            },
          }),
        ],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(baseRequest)) {
        collected.push(event);
      }

      expect(collected.some((e) => e.type === 'text' && (e as any).content === 'Fallback response')).toBe(true);
    });

    it('yields orchestrator output when no tool calls and no fallback', async () => {
      const mockLoop = {
        async *run(_request: ChatRequest) {
          yield { type: 'text', content: 'Direct response' } as ChatEvent;
          yield { type: 'done' } as ChatEvent;
        },
      } as any;

      const config: OrchestratorConfig = {
        strategy: 'orchestrate',
        agentLoop: mockLoop,
        bindings: [makeBinding()],
      };

      const orchestrator = new Orchestrator(config);
      const collected: ChatEvent[] = [];
      for await (const event of orchestrator.run(baseRequest)) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({ type: 'text', content: 'Direct response' });
    });
  });

  describe('runToCompletion()', () => {
    it('collects all text content', async () => {
      const events: ChatEvent[] = [
        { type: 'text', content: 'Hello ' },
        { type: 'text', content: 'world!' },
        { type: 'done' },
      ];

      const config: OrchestratorConfig = {
        strategy: 'route',
        agentLoop: createMockAgentLoop(events),
        bindings: [makeBinding({ keywords: ['help'] })],
      };

      const orchestrator = new Orchestrator(config);
      const result = await orchestrator.runToCompletion(baseRequest);

      expect(result.content).toBe('Hello world!');
    });
  });
});
