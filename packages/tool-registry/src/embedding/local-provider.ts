import type { EmbeddingProvider } from './embedding-provider.js';

/**
 * Local embedding provider using @xenova/transformers (MiniLM-L6-v2).
 * Lazily initializes the pipeline on first use.
 * Requires @xenova/transformers as an optional peer dependency.
 */
export class TransformerEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'transformers-minilm';
  private pipeline: any = null;

  async embed(text: string): Promise<number[]> {
    const pipe = await this.ensurePipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.ensurePipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  private async ensurePipeline(): Promise<any> {
    if (this.pipeline) return this.pipeline;

    let transformers: any;
    try {
      transformers = await (Function('return import("@xenova/transformers")')() as Promise<any>);
    } catch {
      throw new Error(
        'TransformerEmbeddingProvider requires @xenova/transformers. Install with: npm install @xenova/transformers',
      );
    }

    const { pipeline: createPipeline } = transformers;
    this.pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return this.pipeline;
  }
}
