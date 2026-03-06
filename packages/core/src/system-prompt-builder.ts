export interface SystemPromptComponents {
  workspacePrefix?: string;
  basePrompt: string;
  commandPrompt?: string;
  artifactSuffix?: string;
  skillIndexSuffix?: string;
  workingMemoryNotes?: string[];
}

export class SystemPromptBuilder {
  build(components: SystemPromptComponents): string {
    const parts: string[] = [];

    if (components.workspacePrefix) {
      parts.push(components.workspacePrefix);
    }

    parts.push(components.basePrompt);

    if (components.commandPrompt) {
      parts.push(components.commandPrompt);
    }

    if (components.artifactSuffix) {
      parts.push(components.artifactSuffix);
    }

    if (components.skillIndexSuffix) {
      parts.push(components.skillIndexSuffix);
    }

    // Inject working memory notes as a section
    if (components.workingMemoryNotes && components.workingMemoryNotes.length > 0) {
      const notesSection = [
        '## Working Memory',
        ...components.workingMemoryNotes.map((n, i) => `${i + 1}. ${n}`),
      ].join('\n');
      parts.push(notesSection);
    }

    return parts.join('\n\n');
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
