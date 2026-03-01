import type { ToolHandler } from '@nexora-kit/core';

export type SkillInvocation = 'model' | 'user' | 'both';

export interface SkillParameterDef {
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  invocation: SkillInvocation;
  parameters: Record<string, SkillParameterDef>;
  prompt?: string;
  handler?: SkillCodeHandler;
}

export type SkillCodeHandler = (context: SkillContext) => Promise<SkillResult>;

export interface SkillContext {
  input: Record<string, unknown>;
  config: Record<string, unknown>;
  invoke(skillName: string, input: Record<string, unknown>): Promise<SkillResult>;
}

export interface SkillResult {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SkillInfo {
  qualifiedName: string;
  definition: SkillDefinition;
  namespace: string;
  handler: ToolHandler;
}
