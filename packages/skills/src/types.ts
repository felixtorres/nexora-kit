import type { ToolHandler, ResponseBlock, ArtifactOperation } from '@nexora-kit/core';

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
