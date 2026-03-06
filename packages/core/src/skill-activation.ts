import type { SkillResources } from './types.js';

export interface ActiveSkill {
  name: string;
  qualifiedName: string;
  instructions: string;
  allowedTools?: string[];
  context: 'inline' | 'fork';
  agentType?: string;
  resources?: SkillResources;
}

/**
 * Tracks active behavioral skills per conversation.
 *
 * When a Claude-format skill is invoked, its instructions get injected into
 * the agent loop's system prompt. The SkillActivationManager holds this state
 * and provides it to the SystemPromptBuilder each turn.
 */
export class SkillActivationManager {
  private active = new Map<string, ActiveSkill[]>();

  /**
   * Activate a behavioral skill for a conversation.
   * Instructions will be injected into the system prompt on subsequent turns.
   */
  activate(conversationId: string, skill: ActiveSkill): void {
    const skills = this.active.get(conversationId) ?? [];
    // Replace if same skill already active
    const existing = skills.findIndex((s) => s.qualifiedName === skill.qualifiedName);
    if (existing >= 0) {
      skills[existing] = skill;
    } else {
      skills.push(skill);
    }
    this.active.set(conversationId, skills);
  }

  /**
   * Deactivate a specific skill for a conversation.
   */
  deactivate(conversationId: string, qualifiedName: string): void {
    const skills = this.active.get(conversationId);
    if (!skills) return;
    const filtered = skills.filter((s) => s.qualifiedName !== qualifiedName);
    if (filtered.length === 0) {
      this.active.delete(conversationId);
    } else {
      this.active.set(conversationId, filtered);
    }
  }

  /**
   * Deactivate all skills for a conversation.
   */
  deactivateAll(conversationId: string): void {
    this.active.delete(conversationId);
  }

  /**
   * Get combined instructions from all active inline skills for a conversation.
   * Fork-mode skills are excluded — they run in subagents, not the main context.
   */
  getActiveInstructions(conversationId: string): string | undefined {
    const skills = this.active.get(conversationId);
    if (!skills || skills.length === 0) return undefined;

    const inlineSkills = skills.filter((s) => s.context === 'inline');
    if (inlineSkills.length === 0) return undefined;

    const sections = inlineSkills.map((s) =>
      `### Active Skill: ${s.name}\n\n${s.instructions}`,
    );
    return `## Active Skills\n\n${sections.join('\n\n---\n\n')}`;
  }

  /**
   * Get the intersection of allowed tools from all active skills.
   * If no skills restrict tools, returns undefined (all tools allowed).
   * If multiple skills restrict tools, only tools allowed by ALL skills are included.
   */
  getAllowedTools(conversationId: string): string[] | undefined {
    const skills = this.active.get(conversationId);
    if (!skills || skills.length === 0) return undefined;

    const restricting = skills.filter((s) => s.allowedTools && s.allowedTools.length > 0);
    if (restricting.length === 0) return undefined;

    // Intersect all allowed tool sets
    let allowed = new Set(restricting[0].allowedTools!);
    for (let i = 1; i < restricting.length; i++) {
      const next = new Set(restricting[i].allowedTools!);
      allowed = new Set([...allowed].filter((t) => next.has(t)));
    }

    return [...allowed];
  }

  /**
   * Get all active skills (both inline and fork) for a conversation.
   */
  getActive(conversationId: string): ActiveSkill[] {
    return this.active.get(conversationId) ?? [];
  }

  /**
   * Check if any skills are active for a conversation.
   */
  hasActive(conversationId: string): boolean {
    const skills = this.active.get(conversationId);
    return !!skills && skills.length > 0;
  }
}
