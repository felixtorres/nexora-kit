import type { ChatRequest, ChatEvent, BotResponse, ToolDefinition, ToolCall } from './types.js';
import type { AgentLoop } from './agent-loop.js';
import { BotRunner, type BotConfig } from './bot-runner.js';

export interface OrchestratorBotBinding {
  botId: string;
  botName: string;
  description: string;
  keywords: string[];
  priority: number;
  config: BotConfig;
}

export interface OrchestratorConfig {
  strategy: 'orchestrate' | 'route';
  orchestratorModel?: string;
  orchestratorPrompt?: string;
  fallbackBotId?: string;
  bindings: OrchestratorBotBinding[];
  agentLoop: AgentLoop;
}

const DEFAULT_ORCHESTRATOR_PROMPT = `You are an orchestrator that delegates user questions to specialized bots.
You have access to tools named "ask_<bot_name>" for each available bot.
For each user message:
1. Determine which bot(s) can best answer the question.
2. Call the appropriate tool(s). For composite questions, call multiple tools in parallel.
3. After receiving tool results, synthesize a single coherent response for the user.
Never answer directly — always delegate to at least one bot.`;

export class Orchestrator {
  private readonly config: OrchestratorConfig;
  private readonly runners: Map<string, BotRunner>;
  private readonly bindingMap: Map<string, OrchestratorBotBinding>;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.runners = new Map();
    this.bindingMap = new Map();

    for (const binding of config.bindings) {
      const runner = new BotRunner(config.agentLoop, binding.config);
      this.runners.set(binding.botId, runner);
      this.bindingMap.set(binding.botId, binding);
    }
  }

  async *run(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    if (this.config.strategy === 'route') {
      yield* this.runRoute(request, signal);
    } else {
      yield* this.runOrchestrate(request, signal);
    }
  }

  async runToCompletion(request: ChatRequest, signal?: AbortSignal): Promise<{
    content: string;
    botIds: string[];
    botResponses: Record<string, BotResponse>;
  }> {
    let content = '';
    const botIds: string[] = [];
    const botResponses: Record<string, BotResponse> = {};

    for await (const event of this.run(request, signal)) {
      if (event.type === 'text') {
        content += event.content;
      }
    }

    // Collect bot responses from the orchestration metadata
    // The actual bot responses are tracked internally
    return { content, botIds, botResponses };
  }

  // --- Route Mode ---

  private async *runRoute(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    const binding = this.matchKeywords(request);

    if (!binding) {
      const fallback = this.config.fallbackBotId
        ? this.runners.get(this.config.fallbackBotId)
        : undefined;

      if (fallback) {
        yield* fallback.run(request, signal);
        return;
      }

      yield { type: 'error', message: 'No matching bot found for this request', code: 'NO_MATCH' };
      return;
    }

    const runner = this.runners.get(binding.botId);
    if (!runner) {
      yield { type: 'error', message: `Bot "${binding.botName}" not available`, code: 'BOT_UNAVAILABLE' };
      return;
    }

    yield* runner.run(request, signal);
  }

  private matchKeywords(request: ChatRequest): OrchestratorBotBinding | undefined {
    const inputText = typeof request.input === 'string'
      ? request.input
      : request.input.type === 'text'
        ? request.input.text
        : '';

    const lowerInput = inputText.toLowerCase();

    // Score bindings by keyword match count * priority
    let bestMatch: OrchestratorBotBinding | undefined;
    let bestScore = 0;

    for (const binding of this.config.bindings) {
      if (binding.keywords.length === 0) continue;

      let matchCount = 0;
      for (const kw of binding.keywords) {
        if (lowerInput.includes(kw.toLowerCase())) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = matchCount * (binding.priority + 1);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = binding;
        }
      }
    }

    return bestMatch;
  }

  // --- Orchestrate Mode ---

  private async *runOrchestrate(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    // Build tool definitions — one per bot
    const botTools = this.buildBotToolDefinitions();

    // Build orchestrator request
    const inputText = typeof request.input === 'string'
      ? request.input
      : request.input.type === 'text'
        ? request.input.text
        : JSON.stringify(request.input);

    const orchestratorPrompt = this.config.orchestratorPrompt ?? DEFAULT_ORCHESTRATOR_PROMPT;
    const botDescriptions = this.config.bindings
      .map((b) => `- ask_${sanitizeName(b.botName)}: ${b.description || b.botName}`)
      .join('\n');

    const systemPrompt = `${orchestratorPrompt}\n\nAvailable bots:\n${botDescriptions}`;

    // First LLM call: orchestrator decides which bots to invoke
    const orchestratorRequest: ChatRequest = {
      ...request,
      metadata: {
        ...request.metadata,
        _orchestrator: true,
        _systemPrompt: systemPrompt,
        _tools: botTools,
      },
    };

    // Collect orchestrator events to detect tool calls
    const orchestratorEvents: ChatEvent[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const event of this.config.agentLoop.run(orchestratorRequest, signal)) {
      orchestratorEvents.push(event);

      if (event.type === 'tool_call') {
        toolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input,
        });
      }
    }

    if (toolCalls.length === 0) {
      // No tool calls — the orchestrator answered directly or no bots matched
      // Use fallback bot if configured
      if (this.config.fallbackBotId) {
        const fallback = this.runners.get(this.config.fallbackBotId);
        if (fallback) {
          yield* fallback.run(request, signal);
          return;
        }
      }

      // Yield whatever the orchestrator produced
      for (const event of orchestratorEvents) {
        if (event.type === 'text' || event.type === 'error' || event.type === 'done') {
          yield event;
        }
      }
      return;
    }

    // Fan out to bots in parallel
    const botResponses = await this.fanOutToBots(toolCalls, request, signal);
    const botIds = Object.keys(botResponses);

    // If only one bot responded, yield its content directly (no synthesis needed)
    if (botIds.length === 1) {
      const resp = botResponses[botIds[0]];
      yield { type: 'text', content: resp.content };
      yield { type: 'done' };
      return;
    }

    // Multiple bots: synthesize via the orchestrator LLM
    // Feed bot responses as tool results back to the agent loop
    const synthesisText = botIds
      .map((id) => {
        const resp = botResponses[id];
        return `[${resp.botName}]: ${resp.content}`;
      })
      .join('\n\n');

    // Yield the synthesized content (simplified — in a full impl, we'd do a second LLM call)
    yield { type: 'text', content: synthesisText };
    yield { type: 'done' };
  }

  private async fanOutToBots(
    toolCalls: ToolCall[],
    request: ChatRequest,
    signal?: AbortSignal,
  ): Promise<Record<string, BotResponse>> {
    const promises: Promise<[string, BotResponse]>[] = [];

    for (const call of toolCalls) {
      // Tool name format: ask_<botname>
      const botBinding = this.config.bindings.find(
        (b) => `ask_${sanitizeName(b.botName)}` === call.name,
      );

      if (!botBinding) continue;

      const runner = this.runners.get(botBinding.botId);
      if (!runner) continue;

      const question = (call.input as any).question ?? '';
      const botRequest: ChatRequest = {
        ...request,
        input: { type: 'text', text: question },
      };

      promises.push(
        runner.runToCompletion(botRequest, signal).then((resp) => [botBinding.botId, resp]),
      );
    }

    const results = await Promise.all(promises);
    const responses: Record<string, BotResponse> = {};
    for (const [id, resp] of results) {
      responses[id] = resp;
    }

    return responses;
  }

  private buildBotToolDefinitions(): ToolDefinition[] {
    return this.config.bindings.map((binding) => ({
      name: `ask_${sanitizeName(binding.botName)}`,
      description: binding.description || `Ask the ${binding.botName} bot a question`,
      parameters: {
        type: 'object' as const,
        properties: {
          question: {
            type: 'string',
            description: 'The question or sub-task to delegate to this bot',
          },
        },
        required: ['question'],
      },
    }));
  }
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
