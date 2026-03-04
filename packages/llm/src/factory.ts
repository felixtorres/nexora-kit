/**
 * createProviderFromConfig — resolves an LlmProvider from a plain config object.
 *
 * This is the bridge between nexora.yaml / ConfigResolver values and the
 * concrete provider classes.  It is intentionally free of side effects:
 * it reads config, constructs, and returns — nothing else.
 *
 * Supported providers (config.provider):
 *   "anthropic"          — AnthropicProvider (direct Anthropic API)
 *   "wso2-azure-openai"  — Wso2Provider (OAuth2 client-credentials → Azure OpenAI)
 *   "stub" | undefined   — falls back to a no-op stub that prints a helpful message
 *
 * Every option falls through to an environment variable so that secrets are
 * never required to live in the YAML file.
 */

import type { LlmLogger } from './logger.js';
import type { LlmProvider } from './provider.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.js';
import { Wso2Provider } from './providers/wso2.js';

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface AnthropicLlmConfig {
  provider: 'anthropic';
  /** Falls back to ANTHROPIC_API_KEY env var if omitted. */
  apiKey?: string;
  /** Override the Anthropic base URL (useful for local proxies). */
  baseURL?: string;
  /** Default model ID to use when requests don't specify one. */
  model?: string;
  /** Default max output tokens. @default 4096 */
  defaultMaxTokens?: number;
}

export interface Wso2LlmConfig {
  provider: 'wso2-azure-openai';
  /** WSO2 token endpoint. Falls back to WSO2_AUTH_URL env var. */
  wso2AuthUrl?: string;
  /** OAuth2 client ID. Falls back to WSO2_CLIENT_ID env var. */
  wso2ClientId?: string;
  /** OAuth2 client secret. Falls back to WSO2_CLIENT_SECRET env var. */
  wso2ClientSecret?: string;
  /** Gateway base URL. Falls back to WSO2_BASE_URL env var. */
  wso2BaseUrl?: string;
  /** Azure OpenAI deployment name. Falls back to WSO2_DEPLOYMENT_ID env var. */
  wso2DeploymentId?: string;
  /** Azure OpenAI API version. Falls back to WSO2_API_VERSION env var. */
  wso2ApiVersion?: string;
  /** Default max output tokens. @default 4096 */
  defaultMaxTokens?: number;
}

export interface OpenAiCompatibleLlmConfig {
  provider: 'openai-compatible';
  /** Base URL of the OpenAI-compatible API (e.g. "http://localhost:11434"). */
  baseUrl: string;
  /** Model identifier sent in the request body (e.g. "llama3.2:latest"). */
  model: string;
  /** Optional API key sent as a Bearer token. */
  apiKey?: string;
  /** Default max output tokens. @default 4096 */
  defaultMaxTokens?: number;
  /** HTTP request timeout in milliseconds. @default 120_000 */
  timeoutMs?: number;
}

export interface StubLlmConfig {
  provider?: 'stub' | undefined;
}

export type LlmConfig = AnthropicLlmConfig | Wso2LlmConfig | OpenAiCompatibleLlmConfig | StubLlmConfig;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct an LlmProvider from a plain config object.
 *
 * @example
 * ```ts
 * // nexora.yaml → parsed YAML → passed here
 * const provider = createProviderFromConfig({ provider: 'anthropic', apiKey: 'sk-...' });
 * const loop = new AgentLoop({ llm: provider, ... });
 * ```
 *
 * @example
 * ```ts
 * // WSO2 — secrets from environment, only non-secret values in YAML
 * const provider = createProviderFromConfig({
 *   provider: 'wso2-azure-openai',
 *   wso2DeploymentId: 'gpt-4o-prod',
 * });
 * ```
 */
export function createProviderFromConfig(config?: LlmConfig, logger?: LlmLogger): LlmProvider {
  const provider = config?.provider;

  switch (provider) {
    case 'anthropic':
      return createAnthropicProvider(config as AnthropicLlmConfig, logger);

    case 'wso2-azure-openai':
      return createWso2Provider(config as Wso2LlmConfig, logger);

    case 'openai-compatible':
      return createOpenAiCompatibleProvider(config as OpenAiCompatibleLlmConfig, logger);

    case 'stub':
    case undefined:
      return createStubProvider();

    default: {
      // Narrow the never so we can surface a useful error at runtime
      const unknown = (config as { provider: string }).provider;
      throw new Error(
        `Unknown LLM provider "${unknown}". ` +
          `Valid options are: "anthropic", "openai-compatible", "wso2-azure-openai", "stub".`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-provider constructors (separated for testability)
// ---------------------------------------------------------------------------

function createAnthropicProvider(config: AnthropicLlmConfig, logger?: LlmLogger): AnthropicProvider {
  return new AnthropicProvider({
    apiKey: config.apiKey, // falls through to ANTHROPIC_API_KEY in SDK
    baseURL: config.baseURL,
    defaultMaxTokens: config.defaultMaxTokens,
    logger,
  });
}

function createWso2Provider(config: Wso2LlmConfig, logger?: LlmLogger): Wso2Provider {
  return new Wso2Provider({
    authUrl: config.wso2AuthUrl,
    clientId: config.wso2ClientId,
    clientSecret: config.wso2ClientSecret,
    baseUrl: config.wso2BaseUrl,
    deploymentId: config.wso2DeploymentId,
    apiVersion: config.wso2ApiVersion,
    defaultMaxTokens: config.defaultMaxTokens,
    logger,
  });
}

function createOpenAiCompatibleProvider(config: OpenAiCompatibleLlmConfig, logger?: LlmLogger): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    defaultMaxTokens: config.defaultMaxTokens,
    timeoutMs: config.timeoutMs,
    logger,
  });
}

function createStubProvider(): LlmProvider {
  return {
    name: 'stub',
    models: [
      {
        id: 'stub',
        name: 'Stub Provider',
        provider: 'stub',
        contextWindow: 100_000,
        maxOutputTokens: 4_096,
      },
    ],
    async *chat() {
      yield {
        type: 'text' as const,
        content:
          'LLM provider not configured. ' +
          'Set llm.provider in nexora.yaml (e.g. "anthropic", "openai-compatible", or "wso2-azure-openai").',
      };
      yield { type: 'done' as const };
    },
    async countTokens() {
      return 0;
    },
  };
}
