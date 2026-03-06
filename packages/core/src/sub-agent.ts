import type { LlmProvider } from '@nexora-kit/llm';
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
  private activeCount = 0;
  private readonly maxConcurrent: number;

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
  }

  canSpawn(): boolean {
    return this.depth < this.maxDepth && this.activeCount < this.maxConcurrent;
  }

  async run(request: SubAgentRequest, signal?: AbortSignal): Promise<SubAgentResult> {
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
        // Pass sub-agent config so children can spawn at depth+1
        subAgent: this.depth + 1 < this.maxDepth
          ? { maxDepth: this.maxDepth, maxConcurrent: this.maxConcurrent, subAgentMaxTurns: this.subAgentMaxTurns }
          : undefined,
        _depth: this.depth + 1,
      });

      const conversationId = `${agentId}-conv`;
      let textOutput = '';
      let totalTokens = 0;

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
            break;
        }
      }

      return {
        output: textOutput || 'Sub-agent completed with no text output.',
        tokensUsed: totalTokens,
        agentId,
      };
    } finally {
      this.activeCount--;
    }
  }
}
