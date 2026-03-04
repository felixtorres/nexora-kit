import type { SkillInfo } from './types.js';

export interface BuildSkillIndexOptions {
  pluginDocs?: string;
}

export function buildSkillIndex(
  skills: SkillInfo[],
  namespace: string,
  options?: BuildSkillIndexOptions,
): string {
  if (skills.length === 0 && !options?.pluginDocs) return '';

  const parts: string[] = [];

  if (options?.pluginDocs) {
    parts.push(`## Plugin Reference (${namespace})\n\n${options.pluginDocs}`);
  }

  if (skills.length > 0) {
    const lines: string[] = [`## Available Skills (${namespace})`];
    for (const skill of skills) {
      lines.push(`- **${skill.definition.name}** — ${skill.definition.description}`);
    }
    lines.push('');
    lines.push('To load a skill\'s full instructions, call the `get_skill_context` tool with the skill name.');
    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}
