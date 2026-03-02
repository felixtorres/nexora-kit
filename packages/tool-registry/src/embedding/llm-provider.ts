import type { EmbeddingProvider } from './embedding-provider.js';

/**
 * Embedding provider that wraps an arbitrary embed function.
 * Avoids circular dependency with @nexora-kit/llm.
 */
export class LlmEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private readonly embedFn: (text: string) => Promise<number[]>;

  constructor(name: string, embedFn: (text: string) => Promise<number[]>) {
    this.name = name;
    this.embedFn = embedFn;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedFn(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedFn(t)));
  }
}
