import type { AgentLoop } from '@nexora-kit/core';
import type { PluginLifecycleManager } from '@nexora-kit/plugins';
import type { ApiRequest, ApiResponse } from './types.js';
import { chatRequestSchema } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface HandlerDeps {
  agentLoop: AgentLoop;
  plugins?: PluginLifecycleManager;
}

// --- POST /v1/chat ---

export function createChatHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { message, sessionId, pluginNamespaces, metadata } = parsed.data;
    const resolvedSessionId = sessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const events: unknown[] = [];
    let fullText = '';

    for await (const event of deps.agentLoop.run({
      sessionId: resolvedSessionId,
      message,
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      pluginNamespaces,
      metadata,
    })) {
      events.push(event);
      if (event.type === 'text') {
        fullText += event.content;
      }
    }

    return jsonResponse(200, {
      sessionId: resolvedSessionId,
      message: fullText,
      events,
    });
  };
}

// --- GET /v1/plugins ---

export function createPluginsListHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    if (!deps.plugins) {
      return jsonResponse(200, { plugins: [] });
    }

    const plugins = deps.plugins.listPlugins().map((p) => ({
      name: p.manifest.name,
      namespace: p.manifest.namespace,
      version: p.manifest.version,
      description: p.manifest.description,
      state: p.state,
      toolCount: p.tools.length,
    }));

    return jsonResponse(200, { plugins });
  };
}

// --- GET /v1/plugins/:name ---

export function createPluginDetailHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    if (!deps.plugins) throw new ApiError(404, 'Plugin system not configured');

    const plugin = deps.plugins.getPlugin(req.params.name);
    if (!plugin) throw new ApiError(404, `Plugin not found: ${req.params.name}`);

    return jsonResponse(200, {
      name: plugin.manifest.name,
      namespace: plugin.manifest.namespace,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      state: plugin.state,
      permissions: plugin.manifest.permissions,
      tools: plugin.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
      error: plugin.error,
    });
  };
}

// --- GET /v1/health ---

export function createHealthHandler(deps: HandlerDeps) {
  return async (_req: ApiRequest): Promise<ApiResponse> => {
    const plugins = deps.plugins?.listPlugins() ?? [];
    const enabledCount = plugins.filter((p) => p.state === 'enabled').length;
    const erroredCount = plugins.filter((p) => p.state === 'errored').length;

    const status = erroredCount > 0 ? 'degraded' : 'healthy';

    return jsonResponse(200, {
      status,
      plugins: {
        total: plugins.length,
        enabled: enabledCount,
        errored: erroredCount,
      },
      uptime: process.uptime(),
    });
  };
}
