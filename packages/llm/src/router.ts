import type { LlmProvider } from './provider.js';

export interface RoutingRequest {
  /** Requested model ID (may be generic like 'fast' or 'best') */
  model?: string;
  /** Team making the request */
  teamId?: string;
  /** Plugin namespace */
  pluginNamespace?: string;
  /** Estimated input tokens */
  estimatedTokens?: number;
  /** Required capabilities */
  capabilities?: string[];
}

export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
}

export interface RoutingRule {
  name: string;
  priority: number;
  match: (request: RoutingRequest) => boolean;
  resolve: (request: RoutingRequest, providers: Map<string, LlmProvider>) => ResolvedModel | null;
}

export class ModelRouter {
  private providers = new Map<string, LlmProvider>();
  private rules: RoutingRule[] = [];
  private defaultProvider: string | null = null;
  private defaultModel: string | null = null;

  registerProvider(provider: LlmProvider): void {
    this.providers.set(provider.name, provider);
  }

  setDefault(providerName: string, modelId: string): void {
    this.defaultProvider = providerName;
    this.defaultModel = modelId;
  }

  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  route(request: RoutingRequest): ResolvedModel {
    // Try rules in priority order
    for (const rule of this.rules) {
      if (rule.match(request)) {
        const resolved = rule.resolve(request, this.providers);
        if (resolved) return resolved;
      }
    }

    // If the request specifies a model, try to find it
    if (request.model) {
      for (const provider of this.providers.values()) {
        const model = provider.models.find((m) => m.id === request.model);
        if (model) {
          return { provider, modelId: model.id };
        }
      }
    }

    // Fall back to default
    if (this.defaultProvider && this.defaultModel) {
      const provider = this.providers.get(this.defaultProvider);
      if (provider) {
        return { provider, modelId: this.defaultModel };
      }
    }

    // Last resort: first registered provider, first model
    const firstProvider = this.providers.values().next().value;
    if (!firstProvider) {
      throw new Error('No LLM providers registered');
    }
    return { provider: firstProvider, modelId: firstProvider.models[0]?.id ?? 'default' };
  }

  getProvider(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
