import type { ToolHandler, ToolHandlerResponse, ToolExecutionContext } from '@nexora-kit/core';
import type { LlmProvider } from '@nexora-kit/llm';
import type { ConfigResolver, ConfigContext } from '@nexora-kit/config';
import type { SkillDefinition, SkillContext, SkillResult, WorkspaceAccessor, WorkspaceDocument } from './types.js';
import { renderTemplate } from './template.js';

export interface WorkspaceContextSource {
  getDocument(workspaceId: string, documentId: string): Promise<WorkspaceDocument | null>;
  listDocuments(workspaceId: string): Promise<WorkspaceDocument[]>;
}

export interface SkillHandlerFactoryOptions {
  llmProvider: LlmProvider;
  configResolver: ConfigResolver;
  model?: string;
  workspaceSource?: WorkspaceContextSource;
}

export class SkillHandlerFactory {
  private readonly llm: LlmProvider;
  private readonly config: ConfigResolver;
  private readonly model: string;
  private readonly workspaceSource?: WorkspaceContextSource;

  constructor(options: SkillHandlerFactoryOptions) {
    this.llm = options.llmProvider;
    this.config = options.configResolver;
    this.model = options.model ?? options.llmProvider.models[0]?.id ?? 'default';
    this.workspaceSource = options.workspaceSource;
  }

  createHandler(qualifiedName: string, skillDef: SkillDefinition, namespace: string): ToolHandler {
    if (skillDef.handler) {
      return this.createCodeHandler(skillDef, namespace);
    }
    if (skillDef.prompt) {
      return this.createPromptHandler(skillDef, namespace);
    }
    return async () => `Skill '${qualifiedName}' has no handler or prompt template`;
  }

  private createCodeHandler(skillDef: SkillDefinition, namespace: string): ToolHandler {
    const configResolver = this.config;
    const workspaceSource = this.workspaceSource;

    return async (input: Record<string, unknown>, execContext?: ToolExecutionContext): Promise<string | ToolHandlerResponse> => {
      const configContext: ConfigContext = { pluginNamespace: namespace };
      const configValues = configResolver.getAll(configContext);

      let workspace: WorkspaceAccessor | undefined;
      if (workspaceSource && execContext?.workspaceId) {
        const wsId = execContext.workspaceId;
        workspace = {
          getDocument: (docId: string) => workspaceSource.getDocument(wsId, docId),
          listDocuments: () => workspaceSource.listDocuments(wsId),
        };
      }

      const context: SkillContext = {
        input,
        config: configValues,
        workspace,
        invoke: async () => {
          throw new Error('Skill composition is not yet implemented');
        },
      };

      const result: SkillResult = await skillDef.handler!(context);

      if (typeof result.output !== 'string') {
        // Blocks output — pass structured response
        if (result.isError) {
          throw new Error(JSON.stringify(result.output));
        }
        return { content: '', blocks: result.output, artifacts: result.artifacts };
      }

      if (result.isError) {
        throw new Error(result.output);
      }
      if (result.artifacts && result.artifacts.length > 0) {
        return { content: result.output, artifacts: result.artifacts };
      }
      return result.output;
    };
  }

  private createPromptHandler(skillDef: SkillDefinition, namespace: string): ToolHandler {
    const llm = this.llm;
    const model = this.model;
    const configResolver = this.config;

    return async (input: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> => {
      const configContext: ConfigContext = { pluginNamespace: namespace };
      const configValues = configResolver.getAll(configContext);

      const variables: Record<string, unknown> = { ...input, config: configValues };
      const prompt = renderTemplate(skillDef.prompt!, variables);

      let response = '';
      for await (const event of llm.chat({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      })) {
        if (event.type === 'text') {
          response += event.content;
        }
      }

      return response;
    };
  }
}
