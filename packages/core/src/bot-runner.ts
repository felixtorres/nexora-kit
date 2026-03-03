import type { ChatRequest, ChatEvent, BotResponse } from './types.js';
import type { AgentLoop } from './agent-loop.js';

export interface BotConfig {
  botId: string;
  botName: string;
  systemPrompt: string;
  model: string;
  maxTurns?: number;
  temperature?: number;
  pluginNamespaces?: string[];
}

export class BotRunner {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly config: BotConfig,
  ) {}

  async *run(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent> {
    // Override request with bot-specific config
    const botRequest: ChatRequest = {
      ...request,
      pluginNamespaces: this.config.pluginNamespaces ?? request.pluginNamespaces,
      metadata: {
        ...request.metadata,
        _botId: this.config.botId,
        _botName: this.config.botName,
        _botSystemPrompt: this.config.systemPrompt,
        _botModel: this.config.model,
        _botMaxTurns: this.config.maxTurns,
        _botTemperature: this.config.temperature,
      },
    };

    yield* this.agentLoop.run(botRequest, signal);
  }

  async runToCompletion(request: ChatRequest, signal?: AbortSignal): Promise<BotResponse> {
    const start = Date.now();
    let content = '';
    let tokensUsed = 0;

    for await (const event of this.run(request, signal)) {
      if (event.type === 'text') {
        content += event.content;
      } else if (event.type === 'usage') {
        tokensUsed += event.inputTokens + event.outputTokens;
      }
    }

    return {
      botId: this.config.botId,
      botName: this.config.botName,
      content,
      tokensUsed,
      durationMs: Date.now() - start,
    };
  }
}
