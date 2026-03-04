import type { IAgentStore, IAgentBotBindingStore, IEndUserStore, IConversationStore } from '@nexora-kit/storage';
import type { AgentLoop, MessageStore, ResponseBlock, Logger } from '@nexora-kit/core';
import type { ApiRequest, ApiResponse } from './types.js';
import { createConversationSchema, sendMessageSchema } from './types.js';
import { ApiError, jsonResponse } from './router.js';
import { authenticateEndUser, type EndUserIdentity } from './end-user-auth.js';
import { AgentRateLimiter } from './agent-rate-limit.js';

export interface ClientHandlerDeps {
  agentStore: IAgentStore;
  agentBotBindingStore: IAgentBotBindingStore;
  endUserStore: IEndUserStore;
  conversationStore: IConversationStore;
  messageStore: MessageStore;
  agentLoop: AgentLoop;
  logger?: Logger;
}

const agentRateLimiter = new AgentRateLimiter();

async function resolveAgentAndAuth(
  req: ApiRequest,
  deps: ClientHandlerDeps,
): Promise<{ agentId: string; teamId: string; endUser: EndUserIdentity }> {
  const slug = req.params.slug;

  // We need to find the agent across all teams — for the client API, the slug is globally unique
  // But our store is team-scoped. We need to get by slug without team — let's use the operator's teamId if present,
  // or look up the agent differently.
  // Actually: the client API is unauthenticated by the main auth (it skips it). The agent slug resolves the team.
  // For now, we need a way to find agents by slug. Let's get the agent from the store.
  // The agent store's getBySlug requires teamId, but for the client API we don't know the teamId upfront.
  // Solution: the client handler gets the agent by a special lookup.

  // For the public client API, agents are resolved by slug across all teams.
  // We can't use req.auth.teamId because client endpoints don't go through admin auth.
  // Instead, we'll use a direct DB lookup. Let's pass through any teamId from the agent.

  // The agent store interface requires teamId for getBySlug. But the gateway knows the agent record
  // because we'll do a "global" lookup. For now, let's iterate — in practice this will need an index.
  // Better approach: add a parameter to mark this as a public lookup.

  // Actually, the simplest approach: use req.auth if present (for operator access via client API),
  // or we need to extend the store. Let's add getBySlug as a method that doesn't require teamId
  // by looking in the agent table directly. BUT: our interface requires teamId.

  // Pragmatic fix: the Gateway will pre-resolve the agent and inject it into the request.
  // For now, we'll have the gateway pass agent info via a custom header or params.

  // The cleanest approach: store the agent record when the gateway resolves the slug route.
  // Let's make the handler accept the agent record from the gateway middleware.

  // For now, use req.params._agentId and _teamId set by the gateway middleware.
  const agentId = req.params._agentId;
  const teamId = req.params._teamId;

  if (!agentId || !teamId) {
    throw new ApiError(404, 'Agent not found', 'NOT_FOUND');
  }

  const agent = await deps.agentStore.get(agentId, teamId);
  if (!agent || !agent.enabled) {
    throw new ApiError(404, 'Agent not found', 'NOT_FOUND');
  }

  const endUser = await authenticateEndUser(
    req,
    agent.id,
    agent.endUserAuth,
    deps.endUserStore,
  );

  // Check rate limits
  const msgCheck = agentRateLimiter.check(endUser.endUserId, agent.rateLimits, 'message');
  if (!msgCheck.allowed) {
    throw new ApiError(429, 'Rate limit exceeded', 'RATE_LIMITED');
  }

  return { agentId: agent.id, teamId, endUser };
}

// --- GET /v1/agents/:slug (public — no auth needed) ---

export function createAgentAppearanceHandler(deps: ClientHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const agentId = req.params._agentId;
    const teamId = req.params._teamId;
    if (!agentId || !teamId) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    const agent = await deps.agentStore.get(agentId, teamId);
    if (!agent || !agent.enabled) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    return jsonResponse(200, {
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      appearance: agent.appearance,
      features: agent.features,
    });
  };
}

// --- POST /v1/agents/:slug/conversations ---

export function createClientConversationCreateHandler(deps: ClientHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const { agentId, teamId, endUser } = await resolveAgentAndAuth(req, deps);

    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    // Check conversation rate limit
    const convCheck = agentRateLimiter.check(endUser.endUserId, (await deps.agentStore.get(agentId, teamId))!.rateLimits, 'conversation');
    if (!convCheck.allowed) {
      throw new ApiError(429, 'Conversation rate limit exceeded', 'RATE_LIMITED');
    }

    const conv = await deps.conversationStore.create({
      teamId,
      userId: endUser.endUserId,
      agentId,
      ...parsed.data,
    });

    return jsonResponse(201, conv);
  };
}

// --- GET /v1/agents/:slug/conversations ---

export function createClientConversationListHandler(deps: ClientHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const { endUser } = await resolveAgentAndAuth(req, deps);

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const cursor = req.query.cursor;

    const result = await deps.conversationStore.list(endUser.endUserId, { limit, cursor });
    return jsonResponse(200, result);
  };
}

// --- GET /v1/agents/:slug/conversations/:id ---

export function createClientConversationGetHandler(deps: ClientHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const { endUser } = await resolveAgentAndAuth(req, deps);

    const conv = await deps.conversationStore.get(req.params.id, endUser.endUserId);
    if (!conv) throw new ApiError(404, 'Conversation not found', 'NOT_FOUND');

    return jsonResponse(200, conv);
  };
}

// --- POST /v1/agents/:slug/conversations/:id/messages ---

export function createClientSendMessageHandler(deps: ClientHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const { agentId, teamId, endUser } = await resolveAgentAndAuth(req, deps);

    const conversationId = req.params.id;

    // Verify conversation belongs to this end user
    const conv = await deps.conversationStore.get(conversationId, endUser.endUserId);
    if (!conv) throw new ApiError(404, 'Conversation not found', 'NOT_FOUND');

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    const input = typeof parsed.data.input === 'string'
      ? { type: 'text' as const, text: parsed.data.input }
      : parsed.data.input;

    const chatRequest = {
      conversationId,
      input,
      teamId,
      userId: endUser.endUserId,
      pluginNamespaces: parsed.data.pluginNamespaces,
      metadata: parsed.data.metadata,
      workspaceId: conv.workspaceId ?? undefined,
    };

    let fullText = '';
    const allBlocks: ResponseBlock[] = [];

    deps.logger?.info('agent_loop.start', { conversationId, agentId });
    for await (const event of deps.agentLoop.run(chatRequest)) {
      if (event.type === 'text') fullText += event.content;
      else if (event.type === 'blocks') allBlocks.push(...event.blocks);
    }
    deps.logger?.info('agent_loop.done', { conversationId, agentId });

    // Update message stats
    const newCount = conv.messageCount + 2; // user + assistant
    await deps.conversationStore.updateMessageStats(
      conversationId,
      newCount,
      new Date().toISOString(),
    );

    // Auto-title if no title set
    if (!conv.title && fullText.length > 0) {
      const autoTitle = fullText.slice(0, 80) + (fullText.length > 80 ? '...' : '');
      await deps.conversationStore.update(conversationId, endUser.endUserId, { title: autoTitle });
    }

    return jsonResponse(200, {
      conversationId,
      message: fullText,
      ...(allBlocks.length > 0 ? { blocks: allBlocks } : {}),
    });
  };
}
