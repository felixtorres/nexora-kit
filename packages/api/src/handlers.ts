import type { AgentLoop, MessageStore, ResponseBlock } from '@nexora-kit/core';
import type { PluginLifecycleManager } from '@nexora-kit/plugins';
import type { IConversationStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { chatRequestSchema, sendMessageSchema, createConversationSchema, updateConversationSchema } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface HandlerDeps {
  agentLoop: AgentLoop;
  conversationStore?: IConversationStore;
  messageStore?: MessageStore;
  plugins?: PluginLifecycleManager;
}

// --- POST /v1/conversations ---

export function createConversationCreateHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');
    if (!deps.conversationStore) throw new ApiError(501, 'Conversation store not configured');

    const parsed = createConversationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const conversation = await deps.conversationStore.create({
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      ...parsed.data,
    });

    return jsonResponse(201, conversation);
  };
}

// --- GET /v1/conversations ---

export function createConversationListHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');
    if (!deps.conversationStore) throw new ApiError(501, 'Conversation store not configured');

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const cursor = req.query.cursor || undefined;

    const result = await deps.conversationStore.list(req.auth.userId, { limit, cursor });
    return jsonResponse(200, result);
  };
}

// --- GET /v1/conversations/:id ---

export function createConversationGetHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');
    if (!deps.conversationStore) throw new ApiError(501, 'Conversation store not configured');

    const conversation = await deps.conversationStore.get(req.params.id, req.auth.userId);
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    return jsonResponse(200, conversation);
  };
}

// --- PATCH /v1/conversations/:id ---

export function createConversationUpdateHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');
    if (!deps.conversationStore) throw new ApiError(501, 'Conversation store not configured');

    const parsed = updateConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const updated = await deps.conversationStore.update(req.params.id, req.auth.userId, parsed.data);
    if (!updated) throw new ApiError(404, 'Conversation not found');

    return jsonResponse(200, updated);
  };
}

// --- DELETE /v1/conversations/:id ---

export function createConversationDeleteHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');
    if (!deps.conversationStore) throw new ApiError(501, 'Conversation store not configured');

    const deleted = await deps.conversationStore.softDelete(req.params.id, req.auth.userId);
    if (!deleted) throw new ApiError(404, 'Conversation not found');

    return jsonResponse(204, null);
  };
}

// --- POST /v1/conversations/:id/messages ---

export function createSendMessageHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Validate conversation ownership if store is configured
    let conversationSystemPrompt: string | undefined;
    let conversationModel: string | undefined;
    let conversationWorkspaceId: string | undefined;
    if (deps.conversationStore) {
      const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conversation) throw new ApiError(404, 'Conversation not found');
      conversationSystemPrompt = conversation.systemPrompt ?? undefined;
      conversationModel = conversation.model ?? undefined;
      conversationWorkspaceId = conversation.workspaceId ?? undefined;
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { input, pluginNamespaces, metadata } = parsed.data;

    // Normalize input: string shorthand → ChatInputText
    const chatInput = typeof input === 'string' ? { type: 'text' as const, text: input } : input;

    const events: unknown[] = [];
    let fullText = '';
    const allBlocks: ResponseBlock[] = [];

    for await (const event of deps.agentLoop.run({
      conversationId,
      input: chatInput,
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      pluginNamespaces,
      metadata,
      systemPrompt: conversationSystemPrompt,
      model: conversationModel,
      workspaceId: conversationWorkspaceId,
    }, req.signal)) {
      events.push(event);
      if (event.type === 'text') {
        fullText += event.content;
      } else if (event.type === 'blocks') {
        allBlocks.push(...event.blocks);
      }
    }

    // Update message stats + auto-title
    if (deps.conversationStore) {
      const messages = deps.messageStore ? await deps.messageStore.get(conversationId) : [];
      await deps.conversationStore.updateMessageStats(
        conversationId,
        messages.length,
        new Date().toISOString(),
      );

      // Auto-title from first user message (truncated 80 chars)
      const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (conversation && !conversation.title) {
        const inputText = typeof input === 'string' ? input : ('text' in input ? input.text : '');
        if (inputText) {
          const title = inputText.length > 80 ? inputText.slice(0, 77) + '...' : inputText;
          await deps.conversationStore.update(conversationId, req.auth.userId, { title });
        }
      }
    }

    return jsonResponse(200, {
      conversationId,
      message: fullText,
      ...(allBlocks.length > 0 ? { blocks: allBlocks } : {}),
      events,
    });
  };
}

// --- POST /v1/chat (legacy) ---

export function createChatHandler(deps: HandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { input, conversationId, pluginNamespaces, metadata } = parsed.data;
    const resolvedConversationId = conversationId ?? `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Normalize input: string shorthand → ChatInputText
    const chatInput = typeof input === 'string' ? { type: 'text' as const, text: input } : input;

    const events: unknown[] = [];
    let fullText = '';
    const allBlocks: ResponseBlock[] = [];

    for await (const event of deps.agentLoop.run({
      conversationId: resolvedConversationId,
      input: chatInput,
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      pluginNamespaces,
      metadata,
    }, req.signal)) {
      events.push(event);
      if (event.type === 'text') {
        fullText += event.content;
      } else if (event.type === 'blocks') {
        allBlocks.push(...event.blocks);
      }
    }

    return jsonResponse(200, {
      conversationId: resolvedConversationId,
      message: fullText,
      ...(allBlocks.length > 0 ? { blocks: allBlocks } : {}),
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
