import type { IUserMemoryStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface UserMemoryHandlerDeps {
  userMemoryStore: IUserMemoryStore;
}

// --- GET /v1/me/memory ---

export function createListMemoryHandler(deps: UserMemoryHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const namespace = req.query.namespace || undefined;
    const facts = await deps.userMemoryStore.list(req.auth.userId, { namespace });

    return jsonResponse(200, { facts });
  };
}

// --- DELETE /v1/me/memory/:key ---

export function createDeleteMemoryFactHandler(deps: UserMemoryHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const key = decodeURIComponent(req.params.key);
    const deleted = await deps.userMemoryStore.delete(req.auth.userId, key);
    if (!deleted) throw new ApiError(404, 'Fact not found');

    return jsonResponse(204, null);
  };
}

// --- DELETE /v1/me/memory ---

export function createDeleteAllMemoryHandler(deps: UserMemoryHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    if (req.query.confirm !== 'true') {
      throw new ApiError(400, 'Must pass confirm=true to delete all memory', 'CONFIRMATION_REQUIRED');
    }

    await deps.userMemoryStore.deleteAll(req.auth.userId);
    return jsonResponse(204, null);
  };
}
