export interface SystemPromptComponents {
  workspacePrefix?: string;
  basePrompt: string;
  commandPrompt?: string;
  artifactSuffix?: string;
  skillIndexSuffix?: string;
  activeSkillInstructions?: string;
  workingMemoryNotes?: string[];
}

export interface PromptMetrics {
  totalTokens: number;
  breakdown: {
    workspace: number;
    base: number;
    command: number;
    skills: number;
    artifacts: number;
    skillIndex: number;
    workingMemory: number;
  };
}

export class SystemPromptBuilder {
  build(components: SystemPromptComponents): string {
    return this.buildWithMetrics(components).prompt;
  }

  buildWithMetrics(components: SystemPromptComponents): { prompt: string; metrics: PromptMetrics } {
    const parts: string[] = [];
    const breakdown = {
      workspace: 0,
      base: 0,
      command: 0,
      skills: 0,
      artifacts: 0,
      skillIndex: 0,
      workingMemory: 0,
    };

    if (components.workspacePrefix) {
      parts.push(components.workspacePrefix);
      breakdown.workspace = estimateTokenCount(components.workspacePrefix);
    }

    parts.push(components.basePrompt);
    breakdown.base = estimateTokenCount(components.basePrompt);

    if (components.commandPrompt) {
      parts.push(components.commandPrompt);
      breakdown.command = estimateTokenCount(components.commandPrompt);
    }

    // Active behavioral skill instructions — injected after base prompt
    // so the LLM treats them as behavioral overlays
    if (components.activeSkillInstructions) {
      parts.push(components.activeSkillInstructions);
      breakdown.skills = estimateTokenCount(components.activeSkillInstructions);
    }

    if (components.artifactSuffix) {
      parts.push(components.artifactSuffix);
      breakdown.artifacts = estimateTokenCount(components.artifactSuffix);
    }

    if (components.skillIndexSuffix) {
      parts.push(components.skillIndexSuffix);
      breakdown.skillIndex = estimateTokenCount(components.skillIndexSuffix);
    }

    // Inject working memory notes as a section
    if (components.workingMemoryNotes && components.workingMemoryNotes.length > 0) {
      const notesSection = [
        '## Working Memory',
        ...components.workingMemoryNotes.map((n, i) => `${i + 1}. ${n}`),
      ].join('\n');
      parts.push(notesSection);
      breakdown.workingMemory = estimateTokenCount(notesSection);
    }

    const prompt = parts.join('\n\n');
    const totalTokens = Object.values(breakdown).reduce((a, b) => a + b, 0);

    return { prompt, metrics: { totalTokens, breakdown } };
  }

  buildTurnReminders(turn: number, maxTurns: number): string[] {
    const remaining = maxTurns - turn;
    const reminders: string[] = [];

    if (turn === 1) {
      reminders.push(
        'Before answering, review your available tools. If the user asks for data, query results, or any action a tool can perform, you MUST use tools rather than outputting raw SQL, code, or instructions for the user to run manually. If you need a capability not in your current tool set, call _search_tools to discover it.',
      );
    }

    if (remaining <= 3 && remaining > 0) {
      reminders.push(
        `[Turn ${turn}/${maxTurns}] You have ${remaining} turn(s) remaining. Prioritize completing the task or use _request_continue if you need more turns.`,
      );
    }

    return reminders;
  }
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
