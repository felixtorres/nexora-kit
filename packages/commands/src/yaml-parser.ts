import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { CommandDefinition } from './types.js';

const argumentSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  alias: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

const yamlCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  args: z.array(argumentSchema).default([]),
  prompt: z.string().optional(),
});

export function parseYamlCommand(content: string): CommandDefinition {
  const raw = parseYaml(content);
  const parsed = yamlCommandSchema.parse(raw);

  return {
    name: parsed.name,
    description: parsed.description,
    args: parsed.args,
    prompt: parsed.prompt,
  };
}
