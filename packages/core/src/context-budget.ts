const CHARS_PER_TOKEN = 4;

export interface ContextBudgetOptions {
  /** Total context window of the model in tokens. */
  contextWindow: number;
  /** Tokens reserved for output generation. */
  reservedOutput: number;
  /** Base tool token budget. */
  toolBudget?: number;
  /** Workspace document budget. */
  workspaceBudget?: number;
  /** Artifact listing budget. */
  artifactBudget?: number;
  /** Skill index budget. */
  skillIndexBudget?: number;
}

export interface BudgetAllocation {
  /** Tokens available for conversation messages. */
  messagesBudget: number;
  /** Total available tokens (contextWindow - reservedOutput). */
  totalAvailable: number;
  /** Whether allocation is in overflow (messagesBudget was negative before clamping). */
  overflow: boolean;
  /** Per-component breakdown of allocated tokens. */
  breakdown: {
    systemPrompt: number;
    tools: number;
    workspace: number;
    artifacts: number;
    skillIndex: number;
    messages: number;
  };
}

export class ContextBudget {
  private readonly contextWindow: number;
  private readonly reservedOutput: number;
  private readonly toolBudget: number;
  private readonly workspaceBudget: number;
  private readonly artifactBudget: number;
  private readonly skillIndexBudget: number;

  constructor(options: ContextBudgetOptions) {
    this.contextWindow = options.contextWindow;
    this.reservedOutput = options.reservedOutput;
    this.toolBudget = options.toolBudget ?? 4000;
    this.workspaceBudget = options.workspaceBudget ?? 2000;
    this.artifactBudget = options.artifactBudget ?? 500;
    this.skillIndexBudget = options.skillIndexBudget ?? 500;
  }

  /**
   * Compute budget allocation given current component sizes.
   * Returns how many tokens remain for conversation messages.
   */
  allocate(components: {
    systemPromptTokens: number;
    toolTokens: number;
    workspaceTokens: number;
    artifactTokens: number;
    skillIndexTokens: number;
  }): BudgetAllocation {
    const totalAvailable = this.contextWindow - this.reservedOutput;

    const overhead =
      components.systemPromptTokens +
      components.toolTokens +
      components.workspaceTokens +
      components.artifactTokens +
      components.skillIndexTokens;

    const messagesBudget = Math.max(0, totalAvailable - overhead);
    const overflow = totalAvailable - overhead < 0;

    return {
      messagesBudget,
      totalAvailable,
      overflow,
      breakdown: {
        systemPrompt: components.systemPromptTokens,
        tools: components.toolTokens,
        workspace: components.workspaceTokens,
        artifacts: components.artifactTokens,
        skillIndex: components.skillIndexTokens,
        messages: messagesBudget,
      },
    };
  }

  /**
   * Compute an adaptive tool budget that shrinks when messages consume most of the context.
   * Returns a tool token budget that's at most `this.toolBudget` but may be smaller.
   */
  adaptiveToolBudget(messageTokens: number): number {
    const totalAvailable = this.contextWindow - this.reservedOutput;
    // If messages consume more than 70% of available tokens, shrink tool budget
    const messageRatio = messageTokens / totalAvailable;
    if (messageRatio > 0.7) {
      // Scale down: at 70% → full budget, at 90% → 30% of budget
      const scale = Math.max(0.3, 1 - (messageRatio - 0.7) / 0.2);
      return Math.floor(this.toolBudget * scale);
    }
    return this.toolBudget;
  }

  /** Estimate tokens for a string. */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  get defaults() {
    return {
      toolBudget: this.toolBudget,
      workspaceBudget: this.workspaceBudget,
      artifactBudget: this.artifactBudget,
      skillIndexBudget: this.skillIndexBudget,
    };
  }
}
