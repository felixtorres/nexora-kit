import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { SkillDefinition } from './types.js';

const skillParameterSchema = z.object({
  type: z.string().default('string'),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.string()).optional(),
});

const yamlSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  invocation: z.enum(['model', 'user', 'both']).default('model'),
  parameters: z.record(skillParameterSchema).default({}),
  prompt: z.string().optional(),
});

export function parseYamlSkill(content: string): SkillDefinition {
  const raw = parseYaml(content);
  const parsed = yamlSkillSchema.parse(raw);

  return {
    name: parsed.name,
    description: parsed.description,
    invocation: parsed.invocation,
    parameters: parsed.parameters,
    prompt: parsed.prompt,
  };
}
