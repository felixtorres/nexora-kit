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
import type { EmbeddingProvider } from './embedding/embedding-provider.js';

export interface ToolSelectorOptions {
  index: ToolIndex;
  logger?: SelectionLogger;
  weights?: {
    keyword: number;
    recency: number;
    context: number;
    embedding?: number;
  };
  pinnedTools?: string[];
  embeddingProvider?: EmbeddingProvider;
}

const DEFAULT_WEIGHTS = {
  keyword: 0.4,
  recency: 0.3,
  context: 0.3,
  embedding: 0,
};

export class ToolSelector implements ToolSelectorInterface {
  private readonly index: ToolIndex;
  private readonly logger: SelectionLogger;
  private readonly weights: typeof DEFAULT_WEIGHTS;
  private readonly pinnedTools: Set<string>;
  private readonly embeddingProvider?: EmbeddingProvider;

  constructor(options: ToolSelectorOptions) {
    this.index = options.index;
    this.logger = options.logger ?? new SelectionLogger();
    this.weights = { ...DEFAULT_WEIGHTS, ...options.weights };
    this.pinnedTools = new Set(options.pinnedTools ?? []);
    this.embeddingProvider = options.embeddingProvider;
  }

  select(request: ToolSelectionRequest): SelectedTools {
    return this.selectInternal(request, []);
  }

  /** Async select with embedding search support */
  async selectAsync(request: ToolSelectionRequest): Promise<SelectedTools> {
    let embeddingCandidates: RankedTool[] = [];

    if (this.embeddingProvider && this.weights.embedding > 0) {
      const queryVec = await this.embeddingProvider.embed(request.query);
      embeddingCandidates = this.index.searchByEmbedding(queryVec, request.namespaces);
    }

    return this.selectInternal(request, embeddingCandidates);
  }

  private selectInternal(
    request: ToolSelectionRequest,
    embeddingCandidates: RankedTool[],
  ): SelectedTools {
    const startTime = performance.now();

    // Empty namespaces = "all namespaces" (no filter).
    const hasNamespaceFilter = request.namespaces.length > 0;

    // 1. Get keyword-scored candidates
    const candidates = this.index.search({
      text: request.query,
      namespaces: request.namespaces,
    });

    // Build recency map
    const recentSet = new Set(request.recentToolNames ?? []);
    const recentList = request.recentToolNames ?? [];

    // Build embedding score map
    const embeddingScoreMap = new Map<string, number>();
    for (const ec of embeddingCandidates) {
      embeddingScoreMap.set(ec.tool.name, ec.score);
    }

    // 2. Merge candidates: keyword + embedding
    const candidateMap = new Map<string, RankedTool>();
    for (const c of candidates) {
      candidateMap.set(c.tool.name, c);
    }
    for (const ec of embeddingCandidates) {
      if (!candidateMap.has(ec.tool.name)) {
        candidateMap.set(ec.tool.name, { ...ec, score: 0 }); // zero keyword score
      }
    }

    // 3. Score each candidate with composite weights
    const scored = [...candidateMap.values()].map((c) => ({
      ...c,
      compositeScore: this.compositeScore(
        c,
        recentSet,
        recentList,
        request.namespaces,
        embeddingScoreMap.get(c.tool.name) ?? 0,
      ),
    }));

    // 4. Also include zero-keyword-score tools that are pinned or recently used.
    //    When namespaces is empty ("all"), scan the full index.
    //    When namespaces is specified, scan only those namespaces.
    const candidateNames = new Set(candidateMap.keys());

    const addPinnedOrRecent = (tool: ToolDefinition, ns: string) => {
      if (candidateNames.has(tool.name)) return;
      if (!this.pinnedTools.has(tool.name) && !recentSet.has(tool.name)) return;
      scored.push({
        tool,
        score: 0,
        namespace: ns,
        source: this.pinnedTools.has(tool.name) ? 'pinned' : 'recency',
        compositeScore: this.pinnedTools.has(tool.name)
          ? 1.0
          : this.weights.recency * this.recencyScore(tool.name, recentList),
      });
    };

    if (hasNamespaceFilter) {
      for (const ns of request.namespaces) {
        for (const tool of this.index.getByNamespace(ns)) {
          addPinnedOrRecent(tool, ns);
        }
      }
    } else {
      // No namespace filter — iterate all registered tools
      for (const tool of this.index.listAll()) {
        // namespace is not directly available from listAll(); resolve from candidateMap or fall back to ''
        const ns = candidateMap.get(tool.name)?.namespace ?? '';
        addPinnedOrRecent(tool, ns);
      }
    }

    // 5. Sort by composite score
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // 6. Separate pinned tools (always included)
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

    // 7. Fill remaining budget
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
    embeddingScore: number,
  ): number {
    const keywordScore = candidate.score * this.weights.keyword;
    const recencyScore = recentSet.has(candidate.tool.name)
      ? this.recencyScore(candidate.tool.name, recentList) * this.weights.recency
      : 0;
    // Empty activeNamespaces = "all namespaces" → always award context score
    const contextScore =
      activeNamespaces.length === 0 || activeNamespaces.includes(candidate.namespace)
        ? this.weights.context
        : 0;
    const embScore = embeddingScore * this.weights.embedding;

    return keywordScore + recencyScore + contextScore + embScore;
  }

  private recencyScore(toolName: string, recentList: string[]): number {
    const index = recentList.lastIndexOf(toolName);
    if (index === -1) return 0;
    // More recent = higher score, exponential decay
    const position = recentList.length - 1 - index;
    return Math.exp(-0.3 * position);
  }
}
