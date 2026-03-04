import type { ArtifactOperation, Permission, ResponseBlock, ToolCall, ToolDefinition, ToolResult } from './types.js';

export interface ToolHandlerResponse {
  content: string;
  blocks?: ResponseBlock[];
  artifacts?: ArtifactOperation[];
}

export interface ToolExecutionContext {
  conversationId: string;
  workspaceId?: string;
  userId?: string;
  teamId?: string;
}

export type ToolHandler = (input: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string | ToolHandlerResponse>;

export interface PermissionChecker {
  check(pluginNamespace: string, permission: Permission): boolean;
}

interface RegisteredTool {
  handler: ToolHandler;
  namespace: string;
  requiredPermissions: Permission[];
}

export class ToolDispatcher {
  private tools = new Map<string, RegisteredTool>();
  private definitions = new Map<string, ToolDefinition>();
  private permissionChecker?: PermissionChecker;

  setPermissionChecker(checker: PermissionChecker): void {
    this.permissionChecker = checker;
  }

  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    options?: { namespace?: string; requiredPermissions?: Permission[] },
  ): void {
    this.definitions.set(definition.name, definition);
    this.tools.set(definition.name, {
      handler,
      namespace: options?.namespace ?? '',
      requiredPermissions: options?.requiredPermissions ?? [],
    });
  }

  unregister(name: string): void {
    this.definitions.delete(name);
    this.tools.delete(name);
  }

  async dispatch(toolCall: ToolCall, callerNamespace?: string, context?: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolUseId: toolCall.id,
        content: `Tool not found: ${toolCall.name}`,
        isError: true,
      };
    }

    // Check permissions if a checker is configured and the tool has requirements
    if (this.permissionChecker && tool.requiredPermissions.length > 0) {
      const ns = callerNamespace ?? tool.namespace;
      for (const perm of tool.requiredPermissions) {
        if (!this.permissionChecker.check(ns, perm)) {
          return {
            toolUseId: toolCall.id,
            content: `Permission denied: plugin '${ns}' lacks '${perm}' for tool '${toolCall.name}'`,
            isError: true,
          };
        }
      }
    }

    try {
      const raw = await tool.handler(toolCall.input, context);
      if (typeof raw === 'string') {
        return { toolUseId: toolCall.id, content: raw };
      }
      return { toolUseId: toolCall.id, content: raw.content, blocks: raw.blocks, artifacts: raw.artifacts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolUseId: toolCall.id,
        content: `Tool execution error: ${message}`,
        isError: true,
      };
    }
  }

  listTools(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  listToolsWithNamespace(): { tool: ToolDefinition; namespace: string }[] {
    return [...this.definitions.entries()].map(([name, tool]) => ({
      tool,
      namespace: this.tools.get(name)?.namespace ?? '',
    }));
  }

  hasHandler(name: string): boolean {
    return this.tools.has(name);
  }
}
