/**
 * WSO2-proxied Azure OpenAI provider for NexoraKit.
 *
 * Authentication flow:
 *   1. Fetch a short-lived Bearer token from the WSO2 token endpoint using
 *      OAuth2 client_credentials grant (handled by Wso2AuthService).
 *   2. Send chat completion requests to the Azure OpenAI deployment exposed
 *      through the WSO2 API Gateway, attaching the Bearer token.
 *
 * The provider exposes an OpenAI-compatible streaming and non-streaming
 * interface translated into NexoraKit's LlmEvent stream.
 *
 * Environment variable convention (all optional if values are provided
 * programmatically via Wso2ProviderOptions):
 *
 *   WSO2_AUTH_URL          - WSO2 token endpoint
 *   WSO2_CLIENT_ID         - OAuth2 client ID
 *   WSO2_CLIENT_SECRET     - OAuth2 client secret
 *   WSO2_BASE_URL          - Gateway base URL (before /openai/deployments/...)
 *   WSO2_DEPLOYMENT_ID     - Azure OpenAI deployment name
 *   WSO2_API_VERSION       - Azure OpenAI API version query param
 */

import type { LlmLogger } from '../logger.js';
import type { LlmProvider } from '../provider.js';
import type { LlmEvent, LlmRequest, ModelInfo } from '../types.js';
import { HeuristicTokenizer, type Tokenizer } from '../tokenizer.js';
import { Wso2AuthService, type Wso2AuthOptions } from './wso2-auth.js';

// ---------------------------------------------------------------------------
// Types mirroring the Azure OpenAI / OpenAI Chat Completions wire format
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
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
  frequency_penalty?: number;
  presence_penalty?: number;
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

export interface Wso2ProviderOptions {
  /**
   * WSO2 token endpoint.
   * @default process.env.WSO2_AUTH_URL
   * @example "https://api-gateway.example.com:443/token"
   */
  authUrl?: string;

  /**
   * OAuth2 client ID issued by WSO2.
   * @default process.env.WSO2_CLIENT_ID
   */
  clientId?: string;

  /**
   * OAuth2 client secret issued by WSO2.
   * @default process.env.WSO2_CLIENT_SECRET
   */
  clientSecret?: string;

  /**
   * WSO2 gateway base URL, up to (but not including) `/openai/deployments/`.
   * @default process.env.WSO2_BASE_URL
   * @example "https://api-gateway.example.com:443/t/org/openaiendpoint/1"
   */
  baseUrl?: string;

  /**
   * Azure OpenAI deployment name embedded in the URL path.
   * Required — set via this option or the WSO2_DEPLOYMENT_ID env var.
   */
  deploymentId?: string;

  /**
   * Azure OpenAI API version query parameter.
   * @default process.env.WSO2_API_VERSION ?? "2024-12-01-preview"
   */
  apiVersion?: string;

  /**
   * Default maximum output tokens when the request does not specify one.
   * @default 4096
   */
  defaultMaxTokens?: number;

  /**
   * HTTP request timeout for LLM calls in milliseconds.
   * @default 60_000
   */
  timeoutMs?: number;

  /**
   * Additional model entries to expose. Useful when multiple Azure OpenAI
   * deployments are accessible through the same WSO2 gateway by varying the
   * deployment ID per request.
   */
  additionalModels?: ModelInfo[];

  /**
   * When true, the provider sends `max_completion_tokens` instead of
   * `max_tokens` in every request. Required for models such as o1, o3, and
   * gpt-5.x that reject the legacy `max_tokens` parameter.
   * @default false
   */
  useMaxCompletionTokens?: boolean;

  /**
   * Override options forwarded to the internal Wso2AuthService.
   * Normally derived from the other options above.
   */
  authOptions?: Partial<Wso2AuthOptions>;

  /**
   * When true, omits parameters that newer OpenAI models (o1, o3, gpt-5.x)
   * reject: `frequency_penalty`, `presence_penalty`, `stream_options`, and
   * `temperature` (when undefined). Use alongside `useMaxCompletionTokens`
   * for full compatibility with these models.
   * @default false
   */
  omitUnsupportedParams?: boolean;

  /**
   * Optional structured logger.
   */
  logger?: LlmLogger;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class Wso2Provider implements LlmProvider {
  readonly name = 'wso2-azure-openai';

  readonly models: ModelInfo[];
  readonly tokenizer: Tokenizer = new HeuristicTokenizer();

  private readonly auth: Wso2AuthService;
  private readonly baseUrl: string;
  private readonly deploymentId: string;
  private readonly apiVersion: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;
  private readonly useMaxCompletionTokens: boolean;
  private readonly omitUnsupportedParams: boolean;
  private readonly logger?: LlmLogger;

  constructor(options: Wso2ProviderOptions = {}) {
    const authUrl =
      options.authUrl ??
      process.env['WSO2_AUTH_URL'] ??
      (() => {
        throw new Error('Wso2Provider: authUrl is required (or set WSO2_AUTH_URL)');
      })();

    const clientId =
      options.clientId ??
      process.env['WSO2_CLIENT_ID'] ??
      (() => {
        throw new Error('Wso2Provider: clientId is required (or set WSO2_CLIENT_ID)');
      })();

    const clientSecret =
      options.clientSecret ??
      process.env['WSO2_CLIENT_SECRET'] ??
      (() => {
        throw new Error('Wso2Provider: clientSecret is required (or set WSO2_CLIENT_SECRET)');
      })();

    this.baseUrl =
      options.baseUrl ??
      process.env['WSO2_BASE_URL'] ??
      (() => {
        throw new Error('Wso2Provider: baseUrl is required (or set WSO2_BASE_URL)');
      })();

    this.deploymentId =
      options.deploymentId ??
      process.env['WSO2_DEPLOYMENT_ID'] ??
      (() => {
        throw new Error('Wso2Provider: deploymentId is required (or set WSO2_DEPLOYMENT_ID)');
      })();

    this.apiVersion = options.apiVersion ?? process.env['WSO2_API_VERSION'] ?? '2024-12-01-preview';

    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.useMaxCompletionTokens = options.useMaxCompletionTokens ?? false;
    this.omitUnsupportedParams = options.omitUnsupportedParams ?? false;
    this.logger = options.logger;

    this.auth = new Wso2AuthService({
      authUrl,
      clientId,
      clientSecret,
      ...options.authOptions,
    });

    // Default model entry reflecting the configured deployment
    const defaultModel: ModelInfo = {
      id: this.deploymentId,
      name: `Azure OpenAI (${this.deploymentId})`,
      provider: this.name,
      contextWindow: 128_000,
      maxOutputTokens: this.defaultMaxTokens,
    };

    this.models = [defaultModel, ...(options.additionalModels ?? [])];
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
    // Rough heuristic: 4 characters ≈ 1 token (same as AnthropicProvider)
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
  // Convenience accessors (useful for health endpoints / diagnostics)
  // -------------------------------------------------------------------------

  /** Expose underlying auth status without leaking credentials. */
  get tokenStatus() {
    return this.auth.getTokenStatus();
  }

  /** Force a token refresh on the next request. */
  clearCachedToken() {
    this.auth.clearCachedToken();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildChatUrl(): string {
    const url = new URL(`${this.baseUrl}/openai/deployments/${this.deploymentId}/chat/completions`);
    url.searchParams.set('api-version', this.apiVersion);
    return url.toString();
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

      // Structured content blocks — group text + tool_use from the same
      // message into a single OpenAI message so the API sees them together.
      // Tool results stay as separate messages.
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
          // Tool results are always separate messages
          result.push({
            role: 'tool',
            content: block.content,
            tool_call_id: block.toolUseId,
          });
        }
      }

      // Emit grouped assistant/user message if we have text or tool calls
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

  /**
   * Sanitize a tool name to match the OpenAI pattern ^[a-zA-Z0-9_-]{1,64}$.
   * Dots are NOT allowed by the OpenAI spec even though they appear in our
   * internal qualified names (e.g. from MCP: "kyvos-mcp.tool_name").
   * Strategy:
   *   1. Strip leading '@'
   *   2. Replace namespace separators ('/', ':') with '__' for readability
   *   3. Replace any remaining illegal chars (including '.') with '_'
   *   4. Truncate to 64 characters
   * Examples:
   *   "@kyvos/kyvos-mcp.kyvos_list_models" → "kyvos__kyvos-mcp_kyvos_list_models"
   *   "my-plugin:greet"                    → "my-plugin__greet"
   *   "@ns/srv.tool"                       → "ns__srv_tool"
   */
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
      messages: this.toOpenAiMessages(request),
      ...(this.omitUnsupportedParams ? {} : { temperature: request.temperature }),
      ...(this.useMaxCompletionTokens
        ? { max_completion_tokens: request.maxTokens ?? this.defaultMaxTokens }
        : { max_tokens: request.maxTokens ?? this.defaultMaxTokens }),
      ...(this.omitUnsupportedParams ? {} : { frequency_penalty: 0, presence_penalty: 0 }),
      stream: request.stream,
      ...(request.stream && !this.omitUnsupportedParams
        ? { stream_options: { include_usage: true } }
        : {}),
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => {
        const sanitized = this.sanitizeToolName(t.name);
        if (toolNameMap) {
          const existing = toolNameMap.get(sanitized);
          if (existing && existing !== t.name) {
            if (this.logger) {
              this.logger.warn('llm.tool_collision', { original: t.name, existing, sanitized });
            } else {
              console.warn(
                `[Wso2Provider] Tool name collision: "${t.name}" and "${existing}" both sanitize to "${sanitized}"`,
              );
            }
          }
          toolNameMap.set(sanitized, t.name);
        }
        return {
          type: 'function',
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

  private async fetchWithAuth(url: string, body: OpenAiChatRequest): Promise<Response> {
    const token = await this.auth.getAccessToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`WSO2 LLM request failed: ${msg}`);
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
      model: this.deploymentId,
      stream: false,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });
    this.logger?.debug('llm.request_body', { model: this.deploymentId, body });

    const response = await this.fetchWithAuth(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const durationMs = Date.now() - startMs;
      this.logger?.error('llm.error', {
        model: this.deploymentId,
        status: response.status,
        durationMs,
        detail,
        requestBody: body,
      });
      throw new Error(`WSO2 API error (HTTP ${response.status}): ${detail}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const durationMs = Date.now() - startMs;
    const choice = data.choices[0];

    if (!choice) {
      this.logger?.error('llm.error', {
        model: this.deploymentId,
        durationMs,
        detail: 'empty response',
      });
      throw new Error('WSO2 API returned an empty response');
    }

    this.logger?.info('llm.response', {
      model: this.deploymentId,
      stream: false,
      status: response.status,
      durationMs,
      finishReason: choice.finish_reason,
      hasContent: !!choice.message.content,
      toolCallCount: choice.message.tool_calls?.length ?? 0,
    });

    // Emit text content if present
    if (choice.message.content) {
      yield { type: 'text', content: choice.message.content };
    }

    // Emit tool calls if present (a response can have both text and tool calls)
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
        model: this.deploymentId,
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
      model: this.deploymentId,
      stream: true,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
    });
    this.logger?.debug('llm.request_body', { model: this.deploymentId, body });

    const response = await this.fetchWithAuth(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const durationMs = Date.now() - startMs;
      this.logger?.error('llm.error', {
        model: this.deploymentId,
        status: response.status,
        durationMs,
        detail,
        requestBody: body,
      });
      throw new Error(`WSO2 API error (HTTP ${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error('WSO2 streaming response has no body');
    }

    this.logger?.debug('llm.stream_start', {
      model: this.deploymentId,
      durationMs: Date.now() - startMs,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    // Accumulate streaming tool call fragments
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
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

              // Accumulate tool call deltas
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
                  model: this.deploymentId,
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

    // Emit accumulated tool calls after stream ends
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
      model: this.deploymentId,
      stream: true,
      durationMs,
      chunkCount,
      toolCallCount: toolCallAccumulator.size,
    });

    yield { type: 'done' };
  }
}
