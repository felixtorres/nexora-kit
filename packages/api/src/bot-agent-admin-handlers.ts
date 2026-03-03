import type { IBotStore, IAgentStore, IAgentBotBindingStore, IEndUserStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import {
  createBotSchema,
  updateBotSchema,
  createAgentSchema,
  updateAgentSchema,
  replaceBindingsSchema,
} from './types.js';
import { ApiError, jsonResponse } from './router.js';

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required', 'FORBIDDEN');
}

export interface BotAgentAdminDeps {
  botStore: IBotStore;
  agentStore: IAgentStore;
  agentBotBindingStore: IAgentBotBindingStore;
  endUserStore: IEndUserStore;
}

// --- Bot CRUD ---

export function createBotCreateHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const parsed = createBotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    const bot = await deps.botStore.create({
      teamId: req.auth!.teamId,
      ...parsed.data,
    });

    return jsonResponse(201, bot);
  };
}

export function createBotListHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const bots = await deps.botStore.list(req.auth!.teamId);
    return jsonResponse(200, { bots });
  };
}

export function createBotGetHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const bot = await deps.botStore.get(req.params.id, req.auth!.teamId);
    if (!bot) throw new ApiError(404, 'Bot not found', 'NOT_FOUND');
    return jsonResponse(200, bot);
  };
}

export function createBotUpdateHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const parsed = updateBotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    const bot = await deps.botStore.update(req.params.id, req.auth!.teamId, parsed.data);
    if (!bot) throw new ApiError(404, 'Bot not found', 'NOT_FOUND');
    return jsonResponse(200, bot);
  };
}

export function createBotDeleteHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const deleted = await deps.botStore.delete(req.params.id, req.auth!.teamId);
    if (!deleted) throw new ApiError(404, 'Bot not found', 'NOT_FOUND');
    return jsonResponse(204, null);
  };
}

// --- Agent CRUD ---

export function createAgentCreateHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    // Validate botId reference if provided
    if (parsed.data.botId) {
      const bot = await deps.botStore.get(parsed.data.botId, req.auth!.teamId);
      if (!bot) throw new ApiError(400, 'Referenced botId does not exist', 'INVALID_REF');
    }
    if (parsed.data.fallbackBotId) {
      const bot = await deps.botStore.get(parsed.data.fallbackBotId, req.auth!.teamId);
      if (!bot) throw new ApiError(400, 'Referenced fallbackBotId does not exist', 'INVALID_REF');
    }

    const agent = await deps.agentStore.create({
      teamId: req.auth!.teamId,
      ...parsed.data,
    });

    return jsonResponse(201, agent);
  };
}

export function createAgentListHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const agents = await deps.agentStore.list(req.auth!.teamId);
    return jsonResponse(200, { agents });
  };
}

export function createAgentGetHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const agent = await deps.agentStore.get(req.params.id, req.auth!.teamId);
    if (!agent) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    const bindings = await deps.agentBotBindingStore.list(agent.id);
    return jsonResponse(200, { ...agent, bindings });
  };
}

export function createAgentUpdateHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    if (parsed.data.botId) {
      const bot = await deps.botStore.get(parsed.data.botId, req.auth!.teamId);
      if (!bot) throw new ApiError(400, 'Referenced botId does not exist', 'INVALID_REF');
    }
    if (parsed.data.fallbackBotId) {
      const bot = await deps.botStore.get(parsed.data.fallbackBotId, req.auth!.teamId);
      if (!bot) throw new ApiError(400, 'Referenced fallbackBotId does not exist', 'INVALID_REF');
    }

    const agent = await deps.agentStore.update(req.params.id, req.auth!.teamId, parsed.data);
    if (!agent) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');
    return jsonResponse(200, agent);
  };
}

export function createAgentDeleteHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const deleted = await deps.agentStore.delete(req.params.id, req.auth!.teamId);
    if (!deleted) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    // Clean up bindings when agent is deleted
    await deps.agentBotBindingStore.removeAll(req.params.id);
    return jsonResponse(204, null);
  };
}

// --- Bindings ---

export function createReplaceBindingsHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const agentId = req.params.id;

    // Verify agent exists
    const agent = await deps.agentStore.get(agentId, req.auth!.teamId);
    if (!agent) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    const parsed = replaceBindingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join(', '), 'VALIDATION_ERROR');
    }

    // Validate all bot references
    for (const b of parsed.data.bindings) {
      const bot = await deps.botStore.get(b.botId, req.auth!.teamId);
      if (!bot) throw new ApiError(400, `Bot "${b.botId}" does not exist`, 'INVALID_REF');
    }

    // Replace: remove all existing, then set new
    await deps.agentBotBindingStore.removeAll(agentId);

    const results = [];
    for (const b of parsed.data.bindings) {
      const binding = await deps.agentBotBindingStore.set({
        agentId,
        botId: b.botId,
        priority: b.priority,
        description: b.description,
        keywords: b.keywords,
      });
      results.push(binding);
    }

    return jsonResponse(200, { bindings: results });
  };
}

// --- End Users ---

export function createEndUserListHandler(deps: BotAgentAdminDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const agentId = req.params.id;

    // Verify agent exists
    const agent = await deps.agentStore.get(agentId, req.auth!.teamId);
    if (!agent) throw new ApiError(404, 'Agent not found', 'NOT_FOUND');

    const users = await deps.endUserStore.list(agentId);
    return jsonResponse(200, { users });
  };
}
