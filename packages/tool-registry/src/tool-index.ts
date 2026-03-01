import type { ToolDefinition, ToolSearchQuery, RankedTool } from '@nexora-kit/core';
import { tokenize, keywordScore } from './keyword-scorer.js';

interface IndexedTool {
  tool: ToolDefinition;
  namespace: string;
  tokens: string[];
}

export class ToolIndex {
  private tools = new Map<string, IndexedTool>();
  private namespaceIndex = new Map<string, Set<string>>();

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
      // Filter by namespace if specified
      if (query.namespaces && query.namespaces.length > 0) {
        if (!query.namespaces.includes(entry.namespace)) continue;
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
