import { describe, it, expect, vi } from 'vitest';
import { LlmEmbeddingProvider } from './llm-provider.js';

describe('LlmEmbeddingProvider', () => {
  it('embeds using the provided function', async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const provider = new LlmEmbeddingProvider('test-llm', mockEmbed);

    expect(provider.name).toBe('test-llm');
    const result = await provider.embed('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbed).toHaveBeenCalledWith('hello world');
  });

  it('embeds batch by mapping over embed function', async () => {
    let callCount = 0;
    const mockEmbed = vi.fn().mockImplementation(async () => {
      callCount++;
      return [callCount * 0.1];
    });

    const provider = new LlmEmbeddingProvider('test', mockEmbed);
    const results = await provider.embedBatch(['a', 'b', 'c']);

    expect(results).toHaveLength(3);
    expect(mockEmbed).toHaveBeenCalledTimes(3);
  });
});

describe('TransformerEmbeddingProvider', () => {
  it('throws when @xenova/transformers is not installed', async () => {
    // Dynamic import of the provider to avoid global module pollution
    const { TransformerEmbeddingProvider } = await import('./local-provider.js');
    const provider = new TransformerEmbeddingProvider();

    await expect(provider.embed('hello')).rejects.toThrow('@xenova/transformers');
  });
});
