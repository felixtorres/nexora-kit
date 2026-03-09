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

    // Pre-filter: collect candidate tool names by namespace to avoid scanning all tools
    const candidates = this.getCandidateNames(query.namespaces);

    for (const name of candidates) {
      const entry = this.tools.get(name);
      if (!entry) continue;

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
    const candidates = this.getCandidateNames(namespaces);

    for (const name of candidates) {
      const entry = this.tools.get(name);
      if (!entry || !entry.embedding) continue;

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

  /** Get candidate tool names filtered by namespaces (using the namespace index). */
  private getCandidateNames(namespaces?: string[]): Set<string> {
    if (!namespaces || namespaces.length === 0) {
      return new Set(this.tools.keys());
    }

    // Check if any of the requested namespaces actually exist in the index
    const anyKnown = namespaces.some((ns) => this.namespaceIndex.has(ns));
    if (!anyKnown) {
      // None of the namespaces are registered — fall back to searching all tools.
      // Handles LLM hallucinating namespaces like "functions" or "database".
      return new Set(this.tools.keys());
    }

    const names = new Set<string>();
    for (const ns of namespaces) {
      const nsTools = this.namespaceIndex.get(ns);
      if (nsTools) {
        for (const name of nsTools) names.add(name);
      }
    }
    // Always include global namespace
    const globalTools = this.namespaceIndex.get(GLOBAL_NAMESPACE);
    if (globalTools) {
      for (const name of globalTools) names.add(name);
    }
    return names;
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
