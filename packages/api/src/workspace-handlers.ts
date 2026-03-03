import { z } from 'zod';
import type { IWorkspaceStore, IContextDocumentStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface WorkspaceHandlerDeps {
  workspaceStore: IWorkspaceStore;
  contextDocumentStore: IContextDocumentStore;
}

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required');
}

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(50_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(50_000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(100_000),
  priority: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(100_000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// --- POST /v1/admin/workspaces ---

export function createWorkspaceCreateHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const workspace = await deps.workspaceStore.create({
      teamId: req.auth!.teamId,
      ...parsed.data,
    });

    return jsonResponse(201, workspace);
  };
}

// --- GET /v1/workspaces ---

export function createWorkspaceListHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const workspaces = await deps.workspaceStore.list(req.auth.teamId);
    return jsonResponse(200, { workspaces });
  };
}

// --- GET /v1/workspaces/:id ---

export function createWorkspaceGetHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const workspace = await deps.workspaceStore.get(req.params.id, req.auth.teamId);
    if (!workspace) throw new ApiError(404, 'Workspace not found');

    return jsonResponse(200, workspace);
  };
}

// --- PATCH /v1/admin/workspaces/:id ---

export function createWorkspaceUpdateHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = updateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const updated = await deps.workspaceStore.update(req.params.id, req.auth!.teamId, parsed.data);
    if (!updated) throw new ApiError(404, 'Workspace not found');

    return jsonResponse(200, updated);
  };
}

// --- DELETE /v1/admin/workspaces/:id ---

export function createWorkspaceDeleteHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    // Delete documents first
    await deps.contextDocumentStore.deleteByWorkspace(req.params.id);

    const deleted = await deps.workspaceStore.delete(req.params.id, req.auth!.teamId);
    if (!deleted) throw new ApiError(404, 'Workspace not found');

    return jsonResponse(204, null);
  };
}

// --- POST /v1/admin/workspaces/:id/documents ---

export function createDocumentCreateHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    // Validate workspace exists and belongs to team
    const workspace = await deps.workspaceStore.get(req.params.id, req.auth!.teamId);
    if (!workspace) throw new ApiError(404, 'Workspace not found');

    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const doc = await deps.contextDocumentStore.create({
      workspaceId: req.params.id,
      ...parsed.data,
    });

    return jsonResponse(201, doc);
  };
}

// --- GET /v1/workspaces/:id/documents ---

export function createDocumentListHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    // Validate workspace belongs to team
    const workspace = await deps.workspaceStore.get(req.params.id, req.auth.teamId);
    if (!workspace) throw new ApiError(404, 'Workspace not found');

    const documents = await deps.contextDocumentStore.listByWorkspace(req.params.id);
    return jsonResponse(200, { documents });
  };
}

// --- PUT /v1/admin/workspaces/:wsId/documents/:id ---

export function createDocumentUpdateHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const updated = await deps.contextDocumentStore.update(req.params.docId, parsed.data);
    if (!updated) throw new ApiError(404, 'Document not found');

    return jsonResponse(200, updated);
  };
}

// --- DELETE /v1/admin/workspaces/:wsId/documents/:id ---

export function createDocumentDeleteHandler(deps: WorkspaceHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const deleted = await deps.contextDocumentStore.delete(req.params.docId);
    if (!deleted) throw new ApiError(404, 'Document not found');

    return jsonResponse(204, null);
  };
}
