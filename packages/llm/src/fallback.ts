import type { LlmProvider } from './provider.js';
import type { LlmEvent, LlmRequest } from './types.js';

export interface FallbackChainOptions {
  providers: LlmProvider[];
  maxRetries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
}

export class FallbackChain {
  private readonly providers: LlmProvider[];
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly backoffMultiplier: number;

  constructor(options: FallbackChainOptions) {
    if (options.providers.length === 0) {
      throw new Error('FallbackChain requires at least one provider');
    }
    this.providers = options.providers;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
  }

  async *chat(request: LlmRequest): AsyncIterable<LlmEvent> {
    const errors: Error[] = [];

    for (const provider of this.providers) {
      // Find a matching model for this provider
      const modelId = this.resolveModel(provider, request.model);
      if (!modelId) continue;

      const providerRequest = { ...request, model: modelId };

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          yield* provider.chat(providerRequest);
          return; // Success — exit entirely
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);

          if (attempt < this.maxRetries) {
            const delay = this.retryDelayMs * Math.pow(this.backoffMultiplier, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
    }

    throw new AggregateError(
      errors,
      `All providers failed after exhausting retries: ${errors.map((e) => e.message).join('; ')}`,
    );
  }

  private resolveModel(provider: LlmProvider, requestedModel: string): string | null {
    // Direct match
    const direct = provider.models.find((m) => m.id === requestedModel);
    if (direct) return direct.id;

    // First available model from this provider
    return provider.models[0]?.id ?? null;
  }
}
