import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition } from './types.js';

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

export function parseMdSkill(content: string): SkillDefinition {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Markdown skill must have YAML frontmatter delimited by ---');
  }

  const frontmatterRaw = parseYaml(match[1]);
  const frontmatter = frontmatterSchema.parse(frontmatterRaw);
  const body = match[2].trim();

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    invocation: frontmatter.invocation,
    parameters: frontmatter.parameters,
    prompt: body || undefined,
  };
}
