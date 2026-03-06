/**
 * Adaptive tool selector — Claude Code-style strategy.
 *
 * - Small tool sets (≤40 tools, ≤80% budget): send ALL tools (passthrough)
 * - Large tool sets: send essential + recently used + conversation-loaded + _search_tools,
 *   filling remaining budget via the existing keyword-based ToolSelector.
 */

import type {
  ToolDefinition,
  ToolSelectionRequest,
  SelectedTools,
  ToolSelectorInterface,
} from '@nexora-kit/core';
import { ToolSelector } from './tool-selector.js';
import { estimateToolTokens, estimateTotalTokens } from './token-estimator.js';
import { getSearchToolsDefinition, SEARCH_TOOLS_NAME } from './search-tools-handler.js';
import type { ConversationToolMemory } from './conversation-tool-memory.js';
import type { ToolIndex } from './tool-index.js';

export interface AdaptiveToolSelectorOptions {
  index: ToolIndex;
  conversationToolMemory: ConversationToolMemory;
  /** Max tool count before switching to search mode (default: 40) */
  searchModeThreshold?: number;
  /** Budget ratio threshold for passthrough (default: 0.8) */
  passthroughBudgetRatio?: number;
  /** Tools always included in search mode */
  essentialTools?: string[];
  /** Inner ToolSelector options */
  innerSelectorOptions?: ConstructorParameters<typeof ToolSelector>[0];
}

const DEFAULT_THRESHOLD = 40;
const DEFAULT_BUDGET_RATIO = 0.8;

export class AdaptiveToolSelector implements ToolSelectorInterface {
  private readonly index: ToolIndex;
  private readonly memory: ConversationToolMemory;
  private readonly innerSelector: ToolSelector;
  private readonly searchModeThreshold: number;
  private readonly passthroughBudgetRatio: number;
  private readonly essentialToolNames: Set<string>;
  private readonly searchToolDef: ToolDefinition;

  constructor(options: AdaptiveToolSelectorOptions) {
    this.index = options.index;
    this.memory = options.conversationToolMemory;
    this.searchModeThreshold = options.searchModeThreshold ?? DEFAULT_THRESHOLD;
    this.passthroughBudgetRatio = options.passthroughBudgetRatio ?? DEFAULT_BUDGET_RATIO;
    this.essentialToolNames = new Set(options.essentialTools ?? []);
    this.searchToolDef = getSearchToolsDefinition();
    this.innerSelector = new ToolSelector(
      options.innerSelectorOptions ?? { index: options.index },
    );
  }

  select(request: ToolSelectionRequest): SelectedTools {
    const startTime = performance.now();

    // Gather all available tools for the requested namespaces
    const allTools = this.getAllTools(request.namespaces);
    const totalTokens = estimateTotalTokens(allTools);
    const budgetLimit = request.tokenBudget * this.passthroughBudgetRatio;

    // Passthrough mode: small set that fits budget
    if (allTools.length <= this.searchModeThreshold && totalTokens <= budgetLimit) {
      return {
        tools: allTools,
        totalTokens,
        droppedCount: 0,
        selectionTimeMs: performance.now() - startTime,
        mode: 'passthrough',
      };
    }

    // Search mode: prioritized assembly
    return this.searchModeSelect(request, allTools, startTime);
  }

  private searchModeSelect(
    request: ToolSelectionRequest,
    allTools: ToolDefinition[],
    startTime: number,
  ): SelectedTools {
    const budget = request.tokenBudget;
    const selected: ToolDefinition[] = [];
    const selectedNames = new Set<string>();
    let usedTokens = 0;

    const addTool = (tool: ToolDefinition): boolean => {
      if (selectedNames.has(tool.name)) return true;
      const tokens = estimateToolTokens(tool);
      if (usedTokens + tokens > budget) return false;
      selected.push(tool);
      selectedNames.add(tool.name);
      usedTokens += tokens;
      return true;
    };

    // Priority 1: _search_tools meta-tool (always)
    addTool(this.searchToolDef);

    // Priority 2: Essential/pinned tools
    const allToolMap = new Map(allTools.map((t) => [t.name, t]));
    for (const name of this.essentialToolNames) {
      const tool = allToolMap.get(name);
      if (tool) addTool(tool);
    }

    // Priority 3: Conversation-loaded tools (from previous _search_tools calls)
    const conversationId = request.conversationId;
    if (conversationId) {
      const loadedNames = this.memory.getLoaded(conversationId);
      for (const name of loadedNames) {
        const tool = allToolMap.get(name);
        if (tool) addTool(tool);
      }
    }

    // Priority 4: Recently used tools
    if (request.recentToolNames) {
      for (const name of request.recentToolNames) {
        const tool = allToolMap.get(name);
        if (tool) addTool(tool);
      }
    }

    // Priority 5: Keyword-scored tools via inner ToolSelector for remaining budget
    const remainingBudget = budget - usedTokens;
    if (remainingBudget > 0) {
      const innerResult = this.innerSelector.select({
        ...request,
        tokenBudget: remainingBudget,
      });
      for (const tool of innerResult.tools) {
        addTool(tool);
      }
    }

    const droppedCount = allTools.length - selected.length;

    return {
      tools: selected,
      totalTokens: usedTokens,
      droppedCount: Math.max(0, droppedCount),
      selectionTimeMs: performance.now() - startTime,
      mode: 'search',
    };
  }

  private getAllTools(namespaces: string[]): ToolDefinition[] {
    if (namespaces.length === 0) {
      return this.index.listAll();
    }
    const seen = new Set<string>();
    const tools: ToolDefinition[] = [];
    for (const ns of namespaces) {
      for (const tool of this.index.getByNamespace(ns)) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          tools.push(tool);
        }
      }
    }
    return tools;
  }
}
