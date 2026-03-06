import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from './types.js';
import { isClaudeFrontmatter, parseClaudeSkillMd } from './skill-md-parser.js';

const frontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  invocation: z.enum(['model', 'user', 'both']).default('model'),
  parameters: z.record(z.object({
    type: z.string().default('string'),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.string()).optional(),
  })).default({}),
});

/**
 * Parse a markdown skill file. Auto-detects format:
 * - If frontmatter contains Claude-specific fields (allowed-tools, context, etc.),
 *   delegates to parseClaudeSkillMd (behavioral mode).
 * - Otherwise, parses as NexoraKit prompt-template skill (existing behavior).
 */
export function parseMdSkill(content: string): SkillDefinition {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Markdown skill must have YAML frontmatter delimited by ---');
  }

  // Peek at frontmatter to detect format
  const frontmatterRaw = parseYaml(match[1]);
  if (frontmatterRaw && typeof frontmatterRaw === 'object' && isClaudeFrontmatter(frontmatterRaw as Record<string, unknown>)) {
    return parseClaudeSkillMd(content);
  }

  // NexoraKit prompt-template format
  const frontmatter = frontmatterSchema.parse(frontmatterRaw);
  const body = match[2].trim();

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    invocation: frontmatter.invocation,
    parameters: frontmatter.parameters,
    prompt: body || undefined,
    executionMode: 'prompt',
  };
}
