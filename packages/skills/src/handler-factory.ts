import type { ToolHandler } from '@nexora-kit/core';
import type { LlmProvider } from '@nexora-kit/llm';
import type { ConfigResolver, ConfigContext } from '@nexora-kit/config';
import type { SkillDefinition, SkillContext, SkillResult } from './types.js';
import { renderTemplate } from './template.js';

export interface SkillHandlerFactoryOptions {
  llmProvider: LlmProvider;
  configResolver: ConfigResolver;
  model?: string;
}

export class SkillHandlerFactory {
  private readonly llm: LlmProvider;
  private readonly config: ConfigResolver;
  private readonly model: string;

  constructor(options: SkillHandlerFactoryOptions) {
    this.llm = options.llmProvider;
    this.config = options.configResolver;
    this.model = options.model ?? options.llmProvider.models[0]?.id ?? 'default';
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

    return async (input: Record<string, unknown>): Promise<string> => {
      const configContext: ConfigContext = { pluginNamespace: namespace };
      const configValues = configResolver.getAll(configContext);

      const context: SkillContext = {
        input,
        config: configValues,
        invoke: async () => {
          throw new Error('Skill composition is not yet implemented');
        },
      };

      const result: SkillResult = await skillDef.handler!(context);
      if (result.isError) {
        throw new Error(result.content);
      }
      return result.content;
    };
  }

  private createPromptHandler(skillDef: SkillDefinition, namespace: string): ToolHandler {
    const llm = this.llm;
    const model = this.model;
    const configResolver = this.config;

    return async (input: Record<string, unknown>): Promise<string> => {
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
