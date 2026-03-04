import type { ToolDefinition, ToolSearchQuery, RankedTool } from '@nexora-kit/core';
import { tokenize, keywordScore } from './keyword-scorer.js';
import type { EmbeddingProvider } from './embedding/embedding-provider.js';
import { cosineSimilarity } from './embedding/cosine.js';

/** Tools registered under this namespace are included in every search regardless of namespace filters. */
export const GLOBAL_NAMESPACE = '__global__';

export interface IndexedTool {
  tool: ToolDefinition;
  namespace: string;
  tokens: string[];
  embedding?: number[];
}

export class ToolIndex {
  private tools = new Map<string, IndexedTool>();
  private namespaceIndex = new Map<string, Set<string>>();
  private readonly embeddingProvider?: EmbeddingProvider;

  constructor(embeddingProvider?: EmbeddingProvider) {
    this.embeddingProvider = embeddingProvider;
  }

  register(tool: ToolDefinition, namespace: string): void {
    const tokens = tokenize(`${tool.name} ${tool.description}`);
    this.tools.set(tool.name, { tool, namespace, tokens });

    let nsSet = this.namespaceIndex.get(namespace);
    if (!nsSet) {
      nsSet = new Set();
      this.namespaceIndex.set(namespace, nsSet);
    }
    nsSet.add(tool.name);
  }

  /** Generate and store embedding for a registered tool */
  async embedTool(name: string): Promise<void> {
    if (!this.embeddingProvider) return;
    const entry = this.tools.get(name);
    if (!entry) return;
    entry.embedding = await this.embeddingProvider.embed(
      `${entry.tool.name} ${entry.tool.description}`,
    );
  }

  /** Embed all registered tools */
  async embedAll(): Promise<void> {
    if (!this.embeddingProvider) return;
    const entries = [...this.tools.entries()];
    const texts = entries.map(([, e]) => `${e.tool.name} ${e.tool.description}`);
    const embeddings = await this.embeddingProvider.embedBatch(texts);
    for (let i = 0; i < entries.length; i++) {
      entries[i][1].embedding = embeddings[i];
    }
  }

  unregister(toolName: string): void {
    const entry = this.tools.get(toolName);
    if (entry) {
      this.namespaceIndex.get(entry.namespace)?.delete(toolName);
      this.tools.delete(toolName);
    }
  }

  search(query: ToolSearchQuery): RankedTool[] {
    const queryTokens = tokenize(query.text);
    const results: RankedTool[] = [];

    for (const [, entry] of this.tools) {
      // Filter by namespace if specified — always include global namespace
      if (query.namespaces && query.namespaces.length > 0) {
        if (!query.namespaces.includes(entry.namespace) && entry.namespace !== GLOBAL_NAMESPACE) {
          continue;
        }
      }

      const score = keywordScore(queryTokens, entry.tokens);
      if (score > 0) {
        results.push({
          tool: entry.tool,
          score,
          namespace: entry.namespace,
          source: 'keyword',
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (query.limit && query.limit > 0) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  /** Search by embedding similarity */
  searchByEmbedding(
    queryVec: number[],
    namespaces?: string[],
    limit?: number,
  ): RankedTool[] {
    const results: RankedTool[] = [];

    for (const [, entry] of this.tools) {
      if (!entry.embedding) continue;
      if (namespaces && namespaces.length > 0) {
        if (!namespaces.includes(entry.namespace) && entry.namespace !== GLOBAL_NAMESPACE) continue;
      }

      const score = cosineSimilarity(queryVec, entry.embedding);
      if (score > 0) {
        results.push({
          tool: entry.tool,
          score,
          namespace: entry.namespace,
          source: 'embedding',
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return limit ? results.slice(0, limit) : results;
  }

  getByNamespace(namespace: string): ToolDefinition[] {
    const names = this.namespaceIndex.get(namespace);
    if (!names) return [];
    return [...names].map((n) => this.tools.get(n)!.tool);
  }

  listAll(): ToolDefinition[] {
    return [...this.tools.values()].map((e) => e.tool);
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
    this.namespaceIndex.clear();
  }
}
