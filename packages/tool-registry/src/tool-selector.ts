import type {
  ToolDefinition,
  ToolSelectionRequest,
  SelectedTools,
  ToolSelectorInterface,
  RankedTool,
} from '@nexora-kit/core';
import { ToolIndex } from './tool-index.js';
import { estimateToolTokens } from './token-estimator.js';
import { SelectionLogger } from './selection-logger.js';

export interface ToolSelectorOptions {
  index: ToolIndex;
  logger?: SelectionLogger;
  weights?: {
    keyword: number;
    recency: number;
    context: number;
  };
  pinnedTools?: string[];
}

const DEFAULT_WEIGHTS = {
  keyword: 0.4,
  recency: 0.3,
  context: 0.3,
};

export class ToolSelector implements ToolSelectorInterface {
  private readonly index: ToolIndex;
  private readonly logger: SelectionLogger;
  private readonly weights: typeof DEFAULT_WEIGHTS;
  private readonly pinnedTools: Set<string>;

  constructor(options: ToolSelectorOptions) {
    this.index = options.index;
    this.logger = options.logger ?? new SelectionLogger();
    this.weights = { ...DEFAULT_WEIGHTS, ...options.weights };
    this.pinnedTools = new Set(options.pinnedTools ?? []);
  }

  select(request: ToolSelectionRequest): SelectedTools {
    const startTime = performance.now();

    // 1. Get keyword-scored candidates
    const candidates = this.index.search({
      text: request.query,
      namespaces: request.namespaces,
    });

    // Build recency map
    const recentSet = new Set(request.recentToolNames ?? []);
    const recentList = request.recentToolNames ?? [];

    // 2. Score each candidate with composite weights
    const scored = candidates.map((c) => ({
      ...c,
      compositeScore: this.compositeScore(c, recentSet, recentList, request.namespaces),
    }));

    // Also include zero-keyword-score tools from active namespaces that are pinned or recent
    const candidateNames = new Set(candidates.map((c) => c.tool.name));
    for (const ns of request.namespaces) {
      const nsTools = this.index.getByNamespace(ns);
      for (const tool of nsTools) {
        if (candidateNames.has(tool.name)) continue;
        if (this.pinnedTools.has(tool.name) || recentSet.has(tool.name)) {
          scored.push({
            tool,
            score: 0,
            namespace: ns,
            source: this.pinnedTools.has(tool.name) ? 'pinned' : 'recency',
            compositeScore: this.pinnedTools.has(tool.name)
              ? 1.0  // Pinned tools get max score
              : this.weights.recency * this.recencyScore(tool.name, recentList),
          });
        }
      }
    }

    // 3. Sort by composite score
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // 4. Separate pinned tools (always included)
    const pinnedResults: ToolDefinition[] = [];
    let pinnedTokens = 0;
    const remaining: typeof scored = [];

    for (const s of scored) {
      if (this.pinnedTools.has(s.tool.name)) {
        pinnedResults.push(s.tool);
        pinnedTokens += estimateToolTokens(s.tool);
      } else {
        remaining.push(s);
      }
    }

    // 5. Fill remaining budget
    const selectedTools: ToolDefinition[] = [...pinnedResults];
    let totalTokens = pinnedTokens;
    let droppedCount = 0;

    for (const s of remaining) {
      const toolTokens = estimateToolTokens(s.tool);
      if (totalTokens + toolTokens <= request.tokenBudget) {
        selectedTools.push(s.tool);
        totalTokens += toolTokens;
      } else {
        droppedCount++;
      }
    }

    const selectionTimeMs = performance.now() - startTime;

    // Log the selection
    this.logger.log({
      timestamp: Date.now(),
      query: request.query,
      selectedCount: selectedTools.length,
      droppedCount,
      tokensUsed: totalTokens,
      timeMs: selectionTimeMs,
      topTools: selectedTools.slice(0, 5).map((t) => t.name),
    });

    return {
      tools: selectedTools,
      totalTokens,
      droppedCount,
      selectionTimeMs,
    };
  }

  private compositeScore(
    candidate: RankedTool,
    recentSet: Set<string>,
    recentList: string[],
    activeNamespaces: string[],
  ): number {
    const keywordScore = candidate.score * this.weights.keyword;
    const recencyScore = recentSet.has(candidate.tool.name)
      ? this.recencyScore(candidate.tool.name, recentList) * this.weights.recency
      : 0;
    const contextScore = activeNamespaces.includes(candidate.namespace)
      ? this.weights.context
      : 0;

    return keywordScore + recencyScore + contextScore;
  }

  private recencyScore(toolName: string, recentList: string[]): number {
    const index = recentList.lastIndexOf(toolName);
    if (index === -1) return 0;
    // More recent = higher score, exponential decay
    const position = recentList.length - 1 - index;
    return Math.exp(-0.3 * position);
  }
}
