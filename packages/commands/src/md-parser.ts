import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { CommandDefinition } from './types.js';

const frontmatterSchema = z.object({
  description: z.string().min(1),
  'argument-hint': z.string().optional(),
});

export function parseMdCommand(content: string, filename: string): CommandDefinition {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Markdown command must have YAML frontmatter delimited by ---');
  }

  const frontmatterRaw = parseYaml(match[1]);
  const frontmatter = frontmatterSchema.parse(frontmatterRaw);
  const body = match[2].trim();

  const name = filename.replace(/\.md$/i, '');

  const args = frontmatter['argument-hint']
    ? [{
        name: 'input',
        type: 'string' as const,
        required: false,
        description: frontmatter['argument-hint'],
      }]
    : [];

  return {
    name,
    description: frontmatter.description,
    args,
    prompt: body || undefined,
  };
}
