import type { IArtifactStore, IConversationStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface ArtifactHandlerDeps {
  artifactStore: IArtifactStore;
  conversationStore?: IConversationStore;
}

// --- GET /v1/conversations/:id/artifacts ---

export function createListArtifactsHandler(deps: ArtifactHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Verify conversation ownership
    if (deps.conversationStore) {
      const conv = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conv) throw new ApiError(404, 'Conversation not found');
    }

    const artifacts = await deps.artifactStore.listByConversation(conversationId);
    return jsonResponse(200, { artifacts });
  };
}

// --- GET /v1/conversations/:id/artifacts/:artifactId ---

export function createGetArtifactHandler(deps: ArtifactHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Verify conversation ownership
    if (deps.conversationStore) {
      const conv = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conv) throw new ApiError(404, 'Conversation not found');
    }

    const artifact = await deps.artifactStore.get(req.params.artifactId);
    if (!artifact || artifact.conversationId !== conversationId) {
      throw new ApiError(404, 'Artifact not found');
    }

    return jsonResponse(200, artifact);
  };
}

// --- GET /v1/conversations/:id/artifacts/:artifactId/versions ---

export function createListArtifactVersionsHandler(deps: ArtifactHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Verify conversation ownership
    if (deps.conversationStore) {
      const conv = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conv) throw new ApiError(404, 'Conversation not found');
    }

    // Verify artifact belongs to conversation
    const artifact = await deps.artifactStore.get(req.params.artifactId);
    if (!artifact || artifact.conversationId !== conversationId) {
      throw new ApiError(404, 'Artifact not found');
    }

    const versions = await deps.artifactStore.listVersions(req.params.artifactId);
    return jsonResponse(200, { versions });
  };
}

// --- GET /v1/conversations/:id/artifacts/:artifactId/versions/:version ---

export function createGetArtifactVersionHandler(deps: ArtifactHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Verify conversation ownership
    if (deps.conversationStore) {
      const conv = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conv) throw new ApiError(404, 'Conversation not found');
    }

    // Verify artifact belongs to conversation
    const artifact = await deps.artifactStore.get(req.params.artifactId);
    if (!artifact || artifact.conversationId !== conversationId) {
      throw new ApiError(404, 'Artifact not found');
    }

    const versionNum = parseInt(req.params.version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new ApiError(400, 'Invalid version number');
    }

    const version = await deps.artifactStore.getVersion(req.params.artifactId, versionNum);
    if (!version) throw new ApiError(404, 'Version not found');

    return jsonResponse(200, version);
  };
}

// --- DELETE /v1/conversations/:id/artifacts/:artifactId ---

export function createDeleteArtifactHandler(deps: ArtifactHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Verify conversation ownership
    if (deps.conversationStore) {
      const conv = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conv) throw new ApiError(404, 'Conversation not found');
    }

    // Verify artifact belongs to conversation
    const artifact = await deps.artifactStore.get(req.params.artifactId);
    if (!artifact || artifact.conversationId !== conversationId) {
      throw new ApiError(404, 'Artifact not found');
    }

    await deps.artifactStore.delete(req.params.artifactId);
    return jsonResponse(204, null);
  };
}
