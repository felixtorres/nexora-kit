import type { LlmProvider, TokenBudget } from '@nexora-kit/llm';
import { AgentLoop, type AgentLoopOptions } from './agent-loop.js';
import { ToolDispatcher } from './dispatcher.js';
import type { ChatEvent } from './types.js';

export interface SubAgentConfig {
  /** Maximum nesting depth. Default: 2 */
  maxDepth?: number;
  /** Maximum concurrent sub-agents. Default: 3 */
  maxConcurrent?: number;
  /** Maximum turns per sub-agent. Default: 10 */
  subAgentMaxTurns?: number;
  /** Max tokens a single sub-agent can consume. Default: 50000 */
  subAgentTokenLimit?: number;
}

export interface SubAgentRequest {
  task: string;
  context?: string;
  tools?: string[];
}

export interface SubAgentResult {
  output: string;
  tokensUsed: number;
  agentId: string;
}

export class SubAgentRunner {
  private readonly parentOptions: AgentLoopOptions;
  private readonly depth: number;
  private readonly maxDepth: number;
  private readonly subAgentMaxTurns: number;
  private readonly subAgentTokenLimit: number;
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly completedTokens = new Map<string, number>();

  constructor(
    parentOptions: AgentLoopOptions,
    depth: number,
    config: SubAgentConfig = {},
  ) {
    this.parentOptions = parentOptions;
    this.depth = depth;
    this.maxDepth = config.maxDepth ?? 2;
    this.subAgentMaxTurns = config.subAgentMaxTurns ?? 10;
    this.maxConcurrent = config.maxConcurrent ?? 3;
    this.subAgentTokenLimit = config.subAgentTokenLimit ?? 50_000;
  }

  canSpawn(): boolean {
    return this.depth < this.maxDepth && this.activeCount < this.maxConcurrent;
  }

  async run(request: SubAgentRequest, signal?: AbortSignal, parentTraceId?: string): Promise<SubAgentResult> {
    if (!this.canSpawn()) {
      return {
        output: 'Cannot spawn sub-agent: depth or concurrency limit reached.',
        tokensUsed: 0,
        agentId: `sub-${Date.now()}`,
      };
    }

    const agentId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeCount++;

    try {
      // Create a filtered tool dispatcher for the child
      const childDispatcher = new ToolDispatcher();
      const parentDispatcher = this.parentOptions.toolDispatcher ?? new ToolDispatcher();

      parentDispatcher.cloneToolsInto(childDispatcher, (name) => {
        // Don't give child its own _spawn_agent at max depth - 1
        if (name === '_spawn_agent' && this.depth + 1 >= this.maxDepth) return false;
        // Filter to requested tools if specified
        if (request.tools && request.tools.length > 0) {
          return request.tools.includes(name);
        }
        // Exclude internal tools
        if (name.startsWith('_')) return false;
        return true;
      });

      const childLoop = new AgentLoop({
        llm: this.parentOptions.llm,
        toolDispatcher: childDispatcher,
        systemPrompt: this.parentOptions.systemPrompt,
        maxTurns: this.subAgentMaxTurns,
        model: this.parentOptions.model,
        enableWorkingMemory: true,
        // Inherit token budget from parent so sub-agents share the same budget
        tokenBudget: this.parentOptions.tokenBudget,
        pluginNamespace: this.parentOptions.pluginNamespace,
        // Share observability so child LLM calls appear in the parent's trace
        observability: this.parentOptions.observability,
        // Pass sub-agent config so children can spawn at depth+1
        subAgent: this.depth + 1 < this.maxDepth
          ? { maxDepth: this.maxDepth, maxConcurrent: this.maxConcurrent, subAgentMaxTurns: this.subAgentMaxTurns, subAgentTokenLimit: this.subAgentTokenLimit }
          : undefined,
        _depth: this.depth + 1,
        _parentTraceId: parentTraceId,
      });

      const conversationId = `${agentId}-conv`;
      let textOutput = '';
      let totalTokens = 0;
      const tokenCap = this.subAgentTokenLimit;

      const contextPrefix = request.context
        ? `Context: ${request.context}\n\nTask: ${request.task}`
        : request.task;

      const stream = childLoop.run(
        {
          conversationId,
          input: { type: 'text', text: contextPrefix },
          teamId: 'sub-agent',
          userId: 'sub-agent',
        },
        signal,
      );

      for await (const event of stream) {
        if (signal?.aborted) break;
        switch (event.type) {
          case 'text':
            textOutput += event.content;
            break;
          case 'usage':
            totalTokens += event.inputTokens + event.outputTokens;
            if (totalTokens > tokenCap) {
              return {
                output: textOutput || `Sub-agent stopped: token limit (${tokenCap}) exceeded.`,
                tokensUsed: totalTokens,
                agentId,
              };
            }
            break;
        }
      }

      const subResult = {
        output: textOutput || 'Sub-agent completed with no text output.',
        tokensUsed: totalTokens,
        agentId,
      };
      this.completedTokens.set(agentId, totalTokens);
      return subResult;
    } finally {
      this.activeCount--;
    }
  }

  /** Retrieve tokens consumed by a completed sub-agent (by agentId extracted from result). */
  getTokensUsed(agentId: string): number {
    return this.completedTokens.get(agentId) ?? 0;
  }
}
