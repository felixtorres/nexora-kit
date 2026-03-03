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

import type { LlmProvider } from '../provider.js';
import type { LlmEvent, LlmRequest, ModelInfo } from '../types.js';
import { Wso2AuthService, type Wso2AuthOptions } from './wso2-auth.js';

// ---------------------------------------------------------------------------
// Types mirroring the Azure OpenAI / OpenAI Chat Completions wire format
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiChatRequest {
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  stream: boolean;
  frequency_penalty?: number;
  presence_penalty?: number;
}

interface OpenAiChoice {
  message: { role: string; content: string | null };
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
interface OpenAiStreamDelta {
  role?: string;
  content?: string | null;
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
   * @default process.env.WSO2_DEPLOYMENT_ID ?? "AOAIsharednonprodgpt4omni"
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
   * Override options forwarded to the internal Wso2AuthService.
   * Normally derived from the other options above.
   */
  authOptions?: Partial<Wso2AuthOptions>;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class Wso2Provider implements LlmProvider {
  readonly name = 'wso2-azure-openai';

  readonly models: ModelInfo[];

  private readonly auth: Wso2AuthService;
  private readonly baseUrl: string;
  private readonly deploymentId: string;
  private readonly apiVersion: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;

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
      options.deploymentId ?? process.env['WSO2_DEPLOYMENT_ID'] ?? 'AOAIsharednonprodgpt4omni';

    this.apiVersion = options.apiVersion ?? process.env['WSO2_API_VERSION'] ?? '2024-12-01-preview';

    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 60_000;

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
    return request.messages
      .filter((m) => m.role !== 'tool') // tool results not supported in this provider
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
  }

  private buildRequestBody(request: LlmRequest): OpenAiChatRequest {
    return {
      messages: this.toOpenAiMessages(request),
      temperature: request.temperature,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      frequency_penalty: 0,
      presence_penalty: 0,
      stream: request.stream,
    };
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
    const body = this.buildRequestBody(request);

    const response = await this.fetchWithAuth(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WSO2 API error (HTTP ${response.status}): ${detail}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const choice = data.choices[0];

    if (!choice?.message?.content) {
      throw new Error('WSO2 API returned an empty response');
    }

    yield { type: 'text', content: choice.message.content };

    if (data.usage) {
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
    const body = this.buildRequestBody(request);

    const response = await this.fetchWithAuth(url, body);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WSO2 API error (HTTP ${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error('WSO2 streaming response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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

              if (delta?.content) {
                yield { type: 'text', content: delta.content };
              }

              if (chunk.usage) {
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

    yield { type: 'done' };
  }
}
