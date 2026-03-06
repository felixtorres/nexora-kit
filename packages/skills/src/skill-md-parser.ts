import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { SkillDefinition, SkillHookConfig } from './types.js';

/**
 * Claude SKILL.md frontmatter fields.
 * See: https://docs.anthropic.com/en/docs/claude-code/skills
 */
const hookConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});

const skillHooksSchema = z.object({
  PreToolUse: z.array(hookConfigSchema).optional(),
  PostToolUse: z.array(hookConfigSchema).optional(),
}).optional();

const claudeFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  'argument-hint': z.string().optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
  'allowed-tools': z.string().optional(),
  model: z.string().optional(),
  context: z.enum(['fork']).optional(),
  agent: z.string().optional(),
  hooks: skillHooksSchema,
  // NexoraKit extensions — ignored by Claude, used by NexoraKit
  invocation: z.enum(['model', 'user', 'both']).optional(),
  parameters: z.record(z.object({
    type: z.string().default('string'),
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.string()).optional(),
  })).optional(),
});

/** Claude-specific frontmatter fields that distinguish from NexoraKit MD skills. */
const CLAUDE_FIELDS = [
  'argument-hint',
  'disable-model-invocation',
  'user-invocable',
  'allowed-tools',
  'context',
  'agent',
] as const;

/**
 * Detect whether frontmatter contains Claude-specific fields.
 */
export function isClaudeFrontmatter(frontmatterRaw: Record<string, unknown>): boolean {
  return CLAUDE_FIELDS.some((field) => field in frontmatterRaw);
}

/**
 * Parse a Claude-format SKILL.md into a SkillDefinition with behavioral execution fields.
 *
 * Key differences from parseMdSkill:
 * - Body is stored as `body` (behavioral instructions), not `prompt` (template)
 * - Uses $ARGUMENTS substitution, not {{var}} Mustache
 * - Supports allowed-tools, context: fork, hooks, model override
 */
export function parseClaudeSkillMd(content: string): SkillDefinition {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('SKILL.md must have YAML frontmatter delimited by ---');
  }

  const frontmatterRaw = parseYaml(match[1]);
  const frontmatter = claudeFrontmatterSchema.parse(frontmatterRaw);
  const body = match[2].trim();

  // Map Claude invocation semantics to NexoraKit
  let invocation = frontmatter.invocation ?? 'both';
  if (frontmatter['user-invocable'] === false) {
    invocation = 'model';
  }
  if (frontmatter['disable-model-invocation'] === true) {
    invocation = 'user';
  }
  // Both flags set means effectively disabled — default to 'user'
  if (frontmatter['disable-model-invocation'] === true && frontmatter['user-invocable'] === false) {
    invocation = 'user';
  }

  // Parse allowed-tools from comma-separated string
  const allowedTools = frontmatter['allowed-tools']
    ? frontmatter['allowed-tools'].split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    invocation,
    parameters: frontmatter.parameters ?? {},
    body: body || undefined,
    executionMode: 'behavioral',
    argumentHint: frontmatter['argument-hint'],
    disableModelInvocation: frontmatter['disable-model-invocation'],
    userInvocable: frontmatter['user-invocable'],
    allowedTools,
    modelOverride: frontmatter.model,
    context: frontmatter.context === 'fork' ? 'fork' : 'inline',
    agentType: frontmatter.agent,
    hooks: frontmatter.hooks as SkillDefinition['hooks'],
  };
}
