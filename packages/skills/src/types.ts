import type { ToolHandler, ResponseBlock, ArtifactOperation, SkillResources } from '@nexora-kit/core';

export type SkillInvocation = 'model' | 'user' | 'both';

export type SkillExecutionMode = 'prompt' | 'behavioral' | 'code';

export interface SkillParameterDef {
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface SkillHookConfig {
  command: string;
  args?: string[];
}

export interface SkillHooks {
  PreToolUse?: SkillHookConfig[];
  PostToolUse?: SkillHookConfig[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  invocation: SkillInvocation;
  parameters: Record<string, SkillParameterDef>;
  prompt?: string;
  handler?: SkillCodeHandler;
  resources?: SkillResources;

  // Claude-compatible behavioral fields
  executionMode?: SkillExecutionMode;
  body?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  modelOverride?: string;
  context?: 'inline' | 'fork';
  agentType?: string;
  hooks?: SkillHooks;
}

export type SkillCodeHandler = (context: SkillContext) => Promise<SkillResult>;

export interface WorkspaceDocument {
  id: string;
  title: string;
  content: string;
  priority: number;
}

export interface WorkspaceAccessor {
  getDocument(id: string): Promise<WorkspaceDocument | null>;
  listDocuments(): Promise<WorkspaceDocument[]>;
}

export interface SkillContext {
  input: Record<string, unknown>;
  config: Record<string, unknown>;
  workspace?: WorkspaceAccessor;
  invoke(skillName: string, input: Record<string, unknown>): Promise<SkillResult>;
}

export interface SkillResult {
  output: string | ResponseBlock[];
  isError?: boolean;
  artifacts?: ArtifactOperation[];
  metadata?: Record<string, unknown>;
}

export interface SkillInfo {
  qualifiedName: string;
  definition: SkillDefinition;
  namespace: string;
  handler: ToolHandler;
}
