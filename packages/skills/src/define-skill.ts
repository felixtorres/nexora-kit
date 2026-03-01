import type { SkillCodeHandler, SkillDefinition, SkillInvocation, SkillParameterDef } from './types.js';

export interface DefineSkillOptions {
  name: string;
  description: string;
  invocation?: SkillInvocation;
  parameters?: Record<string, SkillParameterDef>;
  handler: SkillCodeHandler;
}

export function defineSkill(options: DefineSkillOptions): SkillDefinition {
  if (!options.name || options.name.trim().length === 0) {
    throw new Error('Skill name is required');
  }
  if (!options.description || options.description.trim().length === 0) {
    throw new Error('Skill description is required');
  }
  if (options.name.includes(':')) {
    throw new Error('Skill name must not contain namespace separator ":"');
  }

  return {
    name: options.name,
    description: options.description,
    invocation: options.invocation ?? 'model',
    parameters: options.parameters ?? {},
    handler: options.handler,
  };
}
