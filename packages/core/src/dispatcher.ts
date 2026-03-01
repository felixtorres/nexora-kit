import type { Permission, ToolCall, ToolDefinition, ToolResult } from './types.js';

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

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

  async dispatch(toolCall: ToolCall, callerNamespace?: string): Promise<ToolResult> {
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
      const content = await tool.handler(toolCall.input);
      return { toolUseId: toolCall.id, content };
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

  hasHandler(name: string): boolean {
    return this.tools.has(name);
  }
}
