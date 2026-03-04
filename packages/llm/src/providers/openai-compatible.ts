/**
 * OpenAI-compatible LLM provider for NexoraKit.
 *
 * Works with any API that speaks the OpenAI chat completions wire format:
 * Ollama, LM Studio, vLLM, llama.cpp server, etc.
 *
 * Unlike the WSO2 provider, this has no OAuth2 auth layer — just an optional
 * Bearer token for services that require an API key.
 */

import type { LlmLogger } from '../logger.js';
import type { LlmProvider } from '../provider.js';
import type { LlmEvent, LlmRequest, ModelInfo } from '../types.js';
import { HeuristicTokenizer, type Tokenizer } from '../tokenizer.js';

// ---------------------------------------------------------------------------
// Types mirroring the OpenAI Chat Completions wire format
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

interface OpenAiTool {
  type: 'function';
  function: OpenAiToolFunction;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: OpenAiTool[];
  tool_choice?: 'auto' | 'none' | 'required';
}

interface OpenAiChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAiToolCall[];
  };
  finish_reason: string | null;
}

interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAiChatResponse {
  choices: OpenAiChoice[];
  usage?: OpenAiUsage;
}

// Streaming delta types
interface OpenAiToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAiStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAiToolCallDelta[];
}

interface OpenAiStreamChoice {
  delta: OpenAiStreamDelta;
  finish_reason: string | null;
  index: number;
}

interface OpenAiStreamChunk {
  choices: OpenAiStreamChoice[];
  usage?: OpenAiUsage;
}

// ---------------------------------------------------------------------------
// Provider options
// ---------------------------------------------------------------------------

export interface OpenAiCompatibleProviderOptions {
  /**
   * Base URL of the OpenAI-compatible API.
   * @example "http://localhost:11434" (Ollama)
   * @example "http://localhost:1234" (LM Studio)
   */
  baseUrl: string;

  /**
   * Model identifier sent in the request body.
   * @example "llama3.2:latest"
   */
  model: string;

  /**
   * Optional API key sent as a Bearer token.
   * Omit for local services that don't require auth.
   */
  apiKey?: string;

  /**
   * Default maximum output tokens when the request does not specify one.
   * @default 4096
   */
  defaultMaxTokens?: number;

  /**
   * HTTP request timeout in milliseconds.
   * @default 120_000
   */
  timeoutMs?: number;

  /**
   * When true, the provider sends `max_completion_tokens` instead of
   * `max_tokens` in every request. Required for models such as o1, o3, and
   * gpt-5.x that reject the legacy `max_tokens` parameter.
   * @default false
   */
  useMaxCompletionTokens?: boolean;

  /**
   * Optional structured logger. When provided, the provider emits
   * llm.request, llm.response, llm.usage, and llm.error log entries.
   */
  logger?: LlmLogger;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  readonly models: ModelInfo[];
  readonly tokenizer: Tokenizer = new HeuristicTokenizer();

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;
  private readonly useMaxCompletionTokens: boolean;
  private readonly logger?: LlmLogger;

  constructor(options: OpenAiCompatibleProviderOptions) {
    if (!options.baseUrl) {
      throw new Error('OpenAiCompatibleProvider: baseUrl is required');
    }
    if (!options.model) {
      throw new Error('OpenAiCompatibleProvider: model is required');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.useMaxCompletionTokens = options.useMaxCompletionTokens ?? false;
    this.logger = options.logger;

    this.models = [
      {
        id: this.model,
        name: `OpenAI-Compatible (${this.model})`,
        provider: this.name,
        contextWindow: 128_000,
        maxOutputTokens: this.defaultMaxTokens,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // LlmProvider interface
  // -------------------------------------------------------------------------

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    if (request.stream) {
      yield* this.streamChat(request);
    } else {
      yield* this.blockChat(request);
    }
  }

  async countTokens(messages: LlmRequest['messages']): Promise<number> {
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

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildChatUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  private toOpenAiMessages(request: LlmRequest): OpenAiMessage[] {
    const result: OpenAiMessage[] = [];

    for (const m of request.messages) {
      if (typeof m.content === 'string') {
        result.push({
          role: m.role as OpenAiMessage['role'],
          content: m.content,
        });
        continue;
      }

      let textContent = '';
      const toolCalls: OpenAiToolCall[] = [];

      for (const block of m.content) {
        if (block.type === 'text') {
          textContent += (textContent ? '\n' : '') + block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: this.sanitizeToolName(block.name),
              arguments: JSON.stringify(block.input),
            },
          });
        } else if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            content: block.content,
            tool_call_id: block.toolUseId,
          });
        }
      }

      if (textContent || toolCalls.length > 0) {
        const msg: OpenAiMessage = {
          role: m.role as OpenAiMessage['role'],
          content: textContent || null,
        };
        if (toolCalls.length > 0) {
          msg.tool_calls = toolCalls;
        }
        result.push(msg);
      }
    }

    return result;
  }

  private sanitizeToolName(name: string): string {
    return name
      .replace(/^@/, '')
      .replace(/[/:]/g, '__')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64);
  }

  private buildRequestBody(
    request: LlmRequest,
    toolNameMap?: Map<string, string>,
  ): OpenAiChatRequest {
    const body: OpenAiChatRequest = {
      model: this.model,
      messages: this.toOpenAiMessages(request),
      temperature: request.temperature,
      ...(this.useMaxCompletionTokens
        ? { max_completion_tokens: request.maxTokens ?? this.defaultMaxTokens }
        : { max_tokens: request.maxTokens ?? this.defaultMaxTokens }),
      stream: request.stream,
      ...(request.stream ? { stream_options: { include_usage: true } } : {}),
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => {
        const sanitized = this.sanitizeToolName(t.name);
        if (toolNameMap) {
          const existing = toolNameMap.get(sanitized);
          if (existing && existing !== t.name) {
            const msg = `Tool name collision: "${t.name}" and "${existing}" both sanitize to "${sanitized}"`;
            if (this.logger) {
              this.logger.warn('llm.tool_collision', { original: t.name, existing, sanitized });
            } else {
              console.warn(`[OpenAiCompatibleProvider] ${msg}`);
            }
          }
          toolNameMap.set(sanitized, t.name);
        }
        return {
          type: 'function' as const,
          function: {
            name: sanitized,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          },
        };
      });
      body.tool_choice = 'auto';
    }

    return body;
  }

  private async doFetch(url: string, body: OpenAiChatRequest): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI-compatible LLM request failed: ${msg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async *blockChat(request: LlmRequest): AsyncIterable<LlmEvent> {
    const url = this.buildChatUrl();
    const toolNameMap = new Map<string, string>();
    const body = this.buildRequestBody(request, toolNameMap);
    const startMs = Date.now();

    this.logger?.info('llm.request', {
      model: this.model,
      stream: false,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });

    const response = await this.doFetch(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const durationMs = Date.now() - startMs;
      this.logger?.error('llm.error', {
        model: this.model,
        status: response.status,
        durationMs,
        detail,
      });
      throw new Error(`OpenAI-compatible API error (HTTP ${response.status}): ${detail}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const durationMs = Date.now() - startMs;
    const choice = data.choices[0];

    if (!choice) {
      this.logger?.error('llm.error', { model: this.model, durationMs, detail: 'empty response' });
      throw new Error('OpenAI-compatible API returned an empty response');
    }

    this.logger?.info('llm.response', {
      model: this.model,
      stream: false,
      status: response.status,
      durationMs,
      finishReason: choice.finish_reason,
      hasContent: !!choice.message.content,
      toolCallCount: choice.message.tool_calls?.length ?? 0,
    });

    if (choice.message.content) {
      yield { type: 'text', content: choice.message.content };
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch {
          input = { _raw: toolCall.function.arguments };
        }
        const originalName = toolNameMap.get(toolCall.function.name) ?? toolCall.function.name;
        yield { type: 'tool_call', id: toolCall.id, name: originalName, input };
      }
    }

    if (data.usage) {
      this.logger?.debug('llm.usage', {
        model: this.model,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      });
      yield {
        type: 'usage',
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      };
    }

    yield { type: 'done' };
  }

  private async *streamChat(request: LlmRequest): AsyncIterable<LlmEvent> {
    const url = this.buildChatUrl();
    const toolNameMap = new Map<string, string>();
    const body = this.buildRequestBody(request, toolNameMap);
    const startMs = Date.now();

    this.logger?.info('llm.request', {
      model: this.model,
      stream: true,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });

    const response = await this.doFetch(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const durationMs = Date.now() - startMs;
      this.logger?.error('llm.error', {
        model: this.model,
        status: response.status,
        durationMs,
        detail,
      });
      throw new Error(`OpenAI-compatible API error (HTTP ${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error('OpenAI-compatible streaming response has no body');
    }

    this.logger?.debug('llm.stream_start', { model: this.model, durationMs: Date.now() - startMs });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            const json = trimmed.slice('data: '.length);
            try {
              const chunk = JSON.parse(json) as OpenAiStreamChunk;
              const delta = chunk.choices[0]?.delta;
              chunkCount++;

              if (delta?.content) {
                yield { type: 'text', content: delta.content };
              }

              if (delta?.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                  const idx = tcDelta.index;
                  if (!toolCallAccumulator.has(idx)) {
                    toolCallAccumulator.set(idx, { id: '', name: '', arguments: '' });
                  }
                  const acc = toolCallAccumulator.get(idx)!;
                  if (tcDelta.id) acc.id = tcDelta.id;
                  if (tcDelta.function?.name) acc.name = tcDelta.function.name;
                  if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
                }
              }

              if (chunk.usage) {
                this.logger?.debug('llm.usage', {
                  model: this.model,
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                });
                yield {
                  type: 'usage',
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                };
              }
            } catch {
              // Malformed SSE chunk — skip silently
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const durationMs = Date.now() - startMs;

    for (const [, acc] of [...toolCallAccumulator.entries()].sort(([a], [b]) => a - b)) {
      let input: unknown = {};
      try {
        input = JSON.parse(acc.arguments);
      } catch {
        input = { _raw: acc.arguments };
      }
      const originalName = toolNameMap.get(acc.name) ?? acc.name;
      yield { type: 'tool_call', id: acc.id, name: originalName, input };
    }

    this.logger?.info('llm.response', {
      model: this.model,
      stream: true,
      durationMs,
      chunkCount,
      toolCallCount: toolCallAccumulator.size,
    });

    yield { type: 'done' };
  }
}
