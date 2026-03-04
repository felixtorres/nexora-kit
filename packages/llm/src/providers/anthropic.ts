import Anthropic from '@anthropic-ai/sdk';
import type { LlmLogger } from '../logger.js';
import type { LlmProvider } from '../provider.js';
import type { LlmEvent, LlmRequest, ModelInfo } from '../types.js';
import { HeuristicTokenizer, type Tokenizer } from '../tokenizer.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  defaultMaxTokens?: number;
  logger?: LlmLogger;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly models: ModelInfo[] = [
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      provider: 'anthropic',
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
    },
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      provider: 'anthropic',
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
    },
  ];

  readonly tokenizer: Tokenizer = new HeuristicTokenizer();
  private client: Anthropic;
  private defaultMaxTokens: number;
  private readonly logger?: LlmLogger;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.logger = options.logger;
  }

  /**
   * Sanitize a tool name to match Anthropic's pattern ^[a-zA-Z0-9_-]{1,64}$.
   * Strips leading '@', replaces '/', ':', and '.' with '_'.
   * Examples:
   *   "@kyvos/kyvos-mcp.tool"  → "kyvos_kyvos-mcp_tool"
   *   "my-plugin:greet"        → "my-plugin_greet"
   */
  private sanitizeToolName(name: string): string {
    return name.replace(/^@/, '').replace(/[/:.]/g, '_').slice(0, 64);
  }

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    // Separate system message from conversation
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

    const system =
      systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .filter(Boolean)
        .join('\n\n') || undefined;

    const messages = conversationMessages.map((m) => this.toAnthropicMessage(m));

    // Build tool name map: sanitized → original, so tool calls can be reverse-mapped
    const toolNameMap = new Map<string, string>();
    const tools = request.tools?.map((t) => {
      const sanitized = this.sanitizeToolName(t.name);
      const existing = toolNameMap.get(sanitized);
      if (existing && existing !== t.name) {
        if (this.logger) {
          this.logger.warn('llm.tool_collision', { original: t.name, existing, sanitized });
        } else {
          console.warn(`[AnthropicProvider] Tool name collision: "${t.name}" and "${existing}" both sanitize to "${sanitized}"`);
        }
      }
      toolNameMap.set(sanitized, t.name);
      return {
        name: sanitized,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool['input_schema'],
      };
    });

    if (request.stream) {
      yield* this.streamChat(request.model, system, messages, tools, request, toolNameMap);
    } else {
      yield* this.blockChat(request.model, system, messages, tools, request, toolNameMap);
    }
  }

  private async *streamChat(
    model: string,
    system: string | undefined,
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[] | undefined,
    request: LlmRequest,
    toolNameMap: Map<string, string>,
  ): AsyncIterable<LlmEvent> {
    const startMs = Date.now();

    this.logger?.info('llm.request', {
      model,
      stream: true,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });

    const stream = this.client.messages.stream({
      model,
      system,
      messages,
      tools,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', content: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          // Tool input is streamed as JSON deltas; we handle the complete tool call at content_block_stop
        }
      } else if (event.type === 'message_start' && event.message.usage) {
        yield {
          type: 'usage',
          inputTokens: event.message.usage.input_tokens,
          outputTokens: 0,
        };
      } else if (event.type === 'message_delta' && event.usage) {
        yield {
          type: 'usage',
          inputTokens: 0,
          outputTokens: event.usage.output_tokens,
        };
      }
    }

    // Get final message to extract complete tool calls
    const finalMessage = await stream.finalMessage();
    let toolCallCount = 0;
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCallCount++;
        yield {
          type: 'tool_call',
          id: block.id,
          name: toolNameMap.get(block.name) ?? block.name,
          input: block.input as Record<string, unknown>,
        };
      }
    }

    const durationMs = Date.now() - startMs;
    this.logger?.info('llm.response', {
      model,
      stream: true,
      durationMs,
      stopReason: finalMessage.stop_reason,
      toolCallCount,
    });
    this.logger?.debug('llm.usage', {
      model,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    yield { type: 'done' };
  }

  private async *blockChat(
    model: string,
    system: string | undefined,
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[] | undefined,
    request: LlmRequest,
    toolNameMap: Map<string, string>,
  ): AsyncIterable<LlmEvent> {
    const startMs = Date.now();

    this.logger?.info('llm.request', {
      model,
      stream: false,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });

    const response = await this.client.messages.create({
      model,
      system,
      messages,
      tools,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature,
    });

    const durationMs = Date.now() - startMs;
    let toolCallCount = 0;

    for (const block of response.content) {
      if (block.type === 'text') {
        yield { type: 'text', content: block.text };
      } else if (block.type === 'tool_use') {
        toolCallCount++;
        yield {
          type: 'tool_call',
          id: block.id,
          name: toolNameMap.get(block.name) ?? block.name,
          input: block.input as Record<string, unknown>,
        };
      }
    }

    this.logger?.info('llm.response', {
      model,
      stream: false,
      durationMs,
      stopReason: response.stop_reason,
      hasContent: response.content.some((b) => b.type === 'text'),
      toolCallCount,
    });
    this.logger?.debug('llm.usage', {
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    yield {
      type: 'usage',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    yield { type: 'done' };
  }

  async countTokens(messages: LlmRequest['messages']): Promise<number> {
    // Rough estimation: 4 chars ≈ 1 token
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        totalChars += JSON.stringify(msg.content).length;
      }
    }
    return Math.ceil(totalChars / 4);
  }

  private toAnthropicMessage(msg: {
    role: string;
    content: string | unknown[];
  }): Anthropic.MessageParam {
    if (msg.role === 'tool') {
      // Convert tool results to Anthropic format
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const toolResults = blocks
        .filter(
          (
            b,
          ): b is { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean } =>
            typeof b === 'object' && b !== null && 'type' in b && b.type === 'tool_result',
        )
        .map((b) => ({
          type: 'tool_result' as const,
          tool_use_id: b.toolUseId,
          content: b.content,
          is_error: b.isError,
        }));
      return { role: 'user', content: toolResults };
    }

    if (typeof msg.content === 'string') {
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    }

    // Convert content blocks
    const blocks = (msg.content as Array<{ type: string; [key: string]: unknown }>).map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text as string };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id as string,
          name: this.sanitizeToolName(block.name as string),
          input: block.input as Record<string, unknown>,
        };
      }
      return { type: 'text' as const, text: JSON.stringify(block) };
    });

    return {
      role: msg.role as 'user' | 'assistant',
      content: blocks,
    };
  }
}
